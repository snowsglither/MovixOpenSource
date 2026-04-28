const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const { getAuthIfValid } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const {
  getOAuthClient,
  loadOAuthClients,
  getOAuthClientPublicMetadata,
  resolveClientRedirectUri,
  normalizeRequestedScopes,
} = require('../utils/oauthClients');
const {
  ensureOAuthStorage,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getAccessTokenRecord,
  registerAuthorizationRequest,
  claimAuthorizationRequest,
  AUTHORIZATION_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  createOAuthStorageError,
} = require('../utils/oauthStorage');
const { readUserData, writeUserData } = require('./sync');
const { verifyAccessKey } = require('../checkVip');
const { ensureSafeProfileId, getProfileFilePath } = require('../utils/syncPolicy');
const { v4: uuidv4 } = require('uuid');
const {
  createVipInvoice,
  fetchInvoiceByPublicId,
  listUserVipInvoices,
  refreshInvoiceStatus,
  serializePublicInvoice,
} = require('../utils/vipDonations');

const router = express.Router();

const oauthRateLimitKey = (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

const oauthPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: oauthRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', error_description: 'Trop de requêtes OAuth, réessayez dans un instant.' },
});

const oauthTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  keyGenerator: oauthRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', error_description: 'Trop de requêtes de token, réessayez dans un instant.' },
});

const OAUTH_SCOPE_IMPLICATIONS = {
  'profile.list': ['profile.read'],
  'profile.manage': ['profile.read', 'profile.list'],
  'vip.manage': ['vip.read'],
};
const OAUTH_DEBUG_ENABLED = process.env.MOVIX_OAUTH_DEBUG === 'true';

function logOauthDebug(message, payload) {
  if (!OAUTH_DEBUG_ENABLED) {
    return;
  }

  if (typeof payload === 'undefined') {
    console.log(`[OAuth Debug] ${message}`);
    return;
  }

  console.log(`[OAuth Debug] ${message}`, payload);
}

function sendOauthJsonError(res, statusCode, oauthError, description) {
  return res.status(statusCode).json({
    error: oauthError,
    error_description: description,
  });
}

function getAuthorizationBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authHeader.slice(7).trim() || null;
}

function normalizeCodeChallengeMethod(rawValue) {
  const method = String(rawValue || '').trim().toUpperCase();
  if (!method) {
    return null;
  }

  if (method === 'S256') {
    return method;
  }

  throw createOAuthStorageError('Méthode PKCE non supportée', 400, 'invalid_request');
}

function normalizeCodeChallenge(rawValue, method, required) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    if (required) {
      throw createOAuthStorageError('code_challenge requis pour ce client', 400, 'invalid_request');
    }
    return null;
  }

  if (!method) {
    throw createOAuthStorageError('code_challenge_method requis quand code_challenge est fourni', 400, 'invalid_request');
  }

  if (value.length < 43 || value.length > 128) {
    throw createOAuthStorageError('code_challenge invalide', 400, 'invalid_request');
  }

  return value;
}

function parseAuthorizeRequest(rawValues = {}) {
  const clientId = String(rawValues.client_id || rawValues.clientId || '').trim();
  const responseType = String(rawValues.response_type || rawValues.responseType || '').trim() || 'code';
  const redirectUriInput = rawValues.redirect_uri || rawValues.redirectUri || '';
  const state = typeof rawValues.state === 'string' ? rawValues.state : rawValues.state != null ? String(rawValues.state) : '';

  if (state && (state.length < 8 || state.length > 512)) {
    throw createOAuthStorageError('state doit contenir entre 8 et 512 caractères', 400, 'invalid_request');
  }

  const availableClients = loadOAuthClients();
  const fallbackClient = !clientId && availableClients.length === 1 ? availableClients[0] : null;
  const client = getOAuthClient(clientId) || fallbackClient;

  if (!clientId) {
    if (!client) {
      throw createOAuthStorageError('client_id requis', 400, 'invalid_request');
    }
  }

  if (responseType !== 'code') {
    throw createOAuthStorageError('Seul response_type=code est supporté', 400, 'unsupported_response_type');
  }

  if (!client) {
    throw createOAuthStorageError('Client OAuth inconnu', 400, 'invalid_client');
  }

  const resolvedClientId = client.clientId;

  const redirectUri = resolveClientRedirectUri(client, redirectUriInput);
  const scopes = normalizeRequestedScopes(rawValues.scope, client);
  const codeChallengeMethod = normalizeCodeChallengeMethod(rawValues.code_challenge_method || rawValues.codeChallengeMethod);
  const codeChallenge = normalizeCodeChallenge(rawValues.code_challenge || rawValues.codeChallenge, codeChallengeMethod, client.requirePkce);

  if ((codeChallenge || client.requirePkce) && !codeChallengeMethod) {
    throw createOAuthStorageError('code_challenge_method requis pour ce client', 400, 'invalid_request');
  }

  return {
    client,
    clientId: resolvedClientId,
    redirectUri,
    scopes,
    state,
    responseType,
    codeChallenge,
    codeChallengeMethod,
  };
}

function buildRedirectUri(redirectUri, queryParams) {
  const url = new URL(redirectUri);
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function hasScope(record, scope) {
  const directScopes = Array.isArray(record?.scopes) ? record.scopes : [];
  if (directScopes.includes(scope)) {
    return true;
  }

  return directScopes.some((grantedScope) => {
    const impliedScopes = OAUTH_SCOPE_IMPLICATIONS[grantedScope] || [];
    return impliedScopes.includes(scope);
  });
}

function parseStoredAuth(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getDefaultProfile(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return null;
  }

  return profiles.find((profile) => profile && profile.isDefault) || profiles[0] || null;
}

function sanitizeOauthString(value, maxLength) {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, maxLength).replace(/[<>"']/g, '') || null;
}

function sanitizeOauthAvatarUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('/avatars/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch { /* invalid URL */ }
  return null;
}

function buildUserIdentity(userType, userId, userData) {
  const storedAuth = parseStoredAuth(userData?.auth);
  const storedProfile = storedAuth?.userProfile && typeof storedAuth.userProfile === 'object'
    ? storedAuth.userProfile
    : null;
  const defaultProfile = getDefaultProfile(userData?.profiles);
  const fallbackName = userType === 'bip39'
    ? `Utilisateur-${String(userId).slice(0, 8)}`
    : `Movix-${String(userId).slice(0, 8)}`;
  const fallbackAvatar = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';

  const rawUsername = storedProfile?.username || defaultProfile?.name || fallbackName;
  const rawAvatar = storedProfile?.avatar || defaultProfile?.avatar || fallbackAvatar;

  return {
    id: String(userId),
    username: sanitizeOauthString(rawUsername, 100) || fallbackName,
    avatar: sanitizeOauthAvatarUrl(rawAvatar) || fallbackAvatar,
    provider: storedProfile?.provider || storedAuth?.provider || userType,
  };
}

async function buildVipIdentity(userData) {
  const accessKey = typeof userData?.access_code === 'string' ? userData.access_code.trim() : '';
  if (accessKey) {
    const verified = await verifyAccessKey(accessKey);
    return {
      active: verified.vip === true,
      expiresAt: verified.expiresAt || null,
      duration: verified.duration || null,
    };
  }

  return {
    active: userData?.is_vip === true || userData?.is_vip === 'true',
    expiresAt: typeof userData?.access_code_expires === 'string' ? userData.access_code_expires : null,
    duration: null,
  };
}

async function getOauthAccountPayload(record) {
  const userData = await readUserData(record.userType, record.userId);
  const identity = buildUserIdentity(record.userType, record.userId, userData);
  const vip = await buildVipIdentity(userData);

  return {
    record,
    userData,
    identity,
    vip,
  };
}

function getRequestBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || '';

  return host ? `${protocol}://${host}`.replace(/\/+$/, '') : '';
}

function canAccessVipInvoice(invoice, tokenRecord) {
  if (!invoice || !tokenRecord) {
    return false;
  }

  return String(invoice.created_by_user_id || '') === String(tokenRecord.userId)
    && String(invoice.created_by_user_type || '') === String(tokenRecord.userType);
}

async function getOauthTokenAuth(req, requiredScopes = []) {
  const accessToken = getAuthorizationBearerToken(req);
  if (!accessToken) {
    throw createOAuthStorageError('Token OAuth requis', 401, 'invalid_token');
  }

  const pool = getPool();
  const tokenRecord = await getAccessTokenRecord(pool, accessToken, { touch: true });
  if (!tokenRecord) {
    throw createOAuthStorageError('Token OAuth invalide ou expiré', 401, 'invalid_token');
  }

  const missingScopes = requiredScopes.filter((scope) => !hasScope(tokenRecord, scope));
  if (missingScopes.length > 0) {
    const error = createOAuthStorageError(`Permission OAuth manquante: ${missingScopes.join(', ')}`, 403, 'insufficient_scope');
    error.missingScopes = missingScopes;
    throw error;
  }

  return tokenRecord;
}

router.get('/authorize/preview', oauthPreviewLimiter, async (req, res) => {
  try {
    logOauthDebug('Received /authorize/preview request', {
      url: req.originalUrl,
      clientId: req.query?.client_id || req.query?.clientId || null,
      redirectUri: req.query?.redirect_uri || req.query?.redirectUri || null,
      responseType: req.query?.response_type || req.query?.responseType || null,
      scope: req.query?.scope || null,
      state: req.query?.state || null,
      codeChallengeMethod: req.query?.code_challenge_method || req.query?.codeChallengeMethod || null,
      hasCodeChallenge: Boolean(req.query?.code_challenge || req.query?.codeChallenge),
      origin: req.get('origin') || null,
      referer: req.get('referer') || null,
      userAgent: req.get('user-agent') || null,
    });

    const pool = getPool();
    await ensureOAuthStorage(pool);

    const authorizeRequest = parseAuthorizeRequest(req.query || {});
    logOauthDebug('Parsed authorize preview request', {
      clientId: authorizeRequest.clientId,
      redirectUri: authorizeRequest.redirectUri,
      scopes: authorizeRequest.scopes,
      responseType: authorizeRequest.responseType,
      statePresent: Boolean(authorizeRequest.state),
      codeChallengeMethod: authorizeRequest.codeChallengeMethod,
      hasCodeChallenge: Boolean(authorizeRequest.codeChallenge),
      clientRedirectUris: authorizeRequest.client.redirectUris,
    });

    const requestRecord = await registerAuthorizationRequest(pool, authorizeRequest);

    if (requestRecord?.consumedAt) {
      logOauthDebug('Authorize preview request already consumed', {
        clientId: authorizeRequest.clientId,
        redirectUri: authorizeRequest.redirectUri,
      });
      return res.status(400).json({
        success: false,
        error: 'invalid_grant',
        error_description: 'Cette demande OAuth a déjà été utilisée. Regénérez une nouvelle demande depuis Movix Translate.',
        client: getOAuthClientPublicMetadata(authorizeRequest.client),
      });
    }

    return res.json({
      success: true,
      client: getOAuthClientPublicMetadata(authorizeRequest.client),
      request: {
        clientId: authorizeRequest.clientId,
        redirectUri: authorizeRequest.redirectUri,
        scopes: authorizeRequest.scopes,
        state: authorizeRequest.state,
        requiresPkce: authorizeRequest.client.requirePkce,
        codeChallengeMethod: authorizeRequest.codeChallengeMethod,
        codeChallengeProvided: Boolean(authorizeRequest.codeChallenge),
        codeExpiresInMs: AUTHORIZATION_CODE_TTL_MS,
        accessTokenExpiresInMs: ACCESS_TOKEN_TTL_MS,
      },
    });
  } catch (error) {
    logOauthDebug('Authorize preview failed', {
      message: error.message,
      statusCode: error.statusCode || 400,
      oauthError: error.oauthError || 'invalid_request',
      clientId: req.query?.client_id || req.query?.clientId || null,
      redirectUri: req.query?.redirect_uri || req.query?.redirectUri || null,
      scope: req.query?.scope || null,
    });

    let clientMetadata = null;
    try {
      const clientId = String(req.query?.client_id || req.query?.clientId || '').trim();
      const client = getOAuthClient(clientId);
      if (client) {
        clientMetadata = getOAuthClientPublicMetadata(client);
      }
    } catch {
      // Ignore client resolution errors in error handler.
    }

    return res.status(error.statusCode || 400).json({
      success: false,
      error: error.oauthError || 'invalid_request',
      error_description: error.message || 'Requête OAuth invalide',
      ...(clientMetadata ? { client: clientMetadata } : {}),
    });
  }
});

router.post('/authorize/decision', oauthPreviewLimiter, async (req, res) => {
  let connection = null;
  try {
    const auth = await getAuthIfValid(req);
    if (!auth) {
      return sendOauthJsonError(res, 401, 'unauthorized', 'Authentification Movix requise');
    }

    const authorizeRequest = parseAuthorizeRequest(req.body || {});
    const approve = req.body?.approve === true || req.body?.approve === 'true' || req.body?.decision === 'approve';

    const pool = getPool();
    await ensureOAuthStorage(pool);
    await registerAuthorizationRequest(pool, authorizeRequest);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    await claimAuthorizationRequest(connection, authorizeRequest, approve ? 'approved' : 'rejected');

    if (!approve) {
      await connection.commit();
      return res.json({
        success: true,
        approved: false,
        redirectTo: buildRedirectUri(authorizeRequest.redirectUri, {
          error: 'access_denied',
          error_description: 'L’utilisateur a refusé la demande d’accès',
          state: authorizeRequest.state,
        }),
      });
    }

    const authorizationCode = await createAuthorizationCode(connection, {
      clientId: authorizeRequest.clientId,
      userId: auth.userId,
      userType: auth.userType,
      sessionId: auth.sessionId || null,
      scopes: authorizeRequest.scopes,
      redirectUri: authorizeRequest.redirectUri,
      codeChallenge: authorizeRequest.codeChallenge,
      codeChallengeMethod: authorizeRequest.codeChallengeMethod,
    });

    await connection.commit();

    return res.json({
      success: true,
      approved: true,
      redirectTo: buildRedirectUri(authorizeRequest.redirectUri, {
        code: authorizationCode.code,
        state: authorizeRequest.state,
      }),
      expiresAt: authorizationCode.expiresAt,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback failures.
      }
    }

    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible de traiter la décision OAuth'
    );
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.post('/token', oauthTokenLimiter, async (req, res) => {
  try {
    const grantType = String(req.body?.grant_type || '').trim();
    if (grantType !== 'authorization_code') {
      return sendOauthJsonError(res, 400, 'unsupported_grant_type', 'Seul authorization_code est supporté');
    }

    const clientId = String(req.body?.client_id || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!clientId || !code) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'client_id et code sont requis');
    }

    const client = getOAuthClient(clientId);
    if (!client) {
      return sendOauthJsonError(res, 401, 'invalid_client', 'Client OAuth inconnu');
    }

    const redirectUri = resolveClientRedirectUri(client, req.body?.redirect_uri || '');
    const clientSecret = typeof req.body?.client_secret === 'string' ? req.body.client_secret : '';
    const codeVerifier = typeof req.body?.code_verifier === 'string' ? req.body.code_verifier.trim() : '';

    const pool = getPool();
    await ensureOAuthStorage(pool);

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const [rows] = await pool.execute(
      'SELECT * FROM oauth_authorization_codes WHERE code_hash = ? LIMIT 1',
      [codeHash]
    );
    if (!rows.length) {
      return sendOauthJsonError(res, 400, 'invalid_grant', 'Code d’autorisation invalide');
    }

    const storedChallenge = rows[0].code_challenge || null;
    const storedChallengeMethod = String(rows[0].code_challenge_method || '').trim().toUpperCase() || null;

    const verifyPkce = () => {
      if (!storedChallenge || storedChallengeMethod !== 'S256') {
        return false;
      }

      if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
        return false;
      }

      const digest = crypto.createHash('sha256').update(codeVerifier).digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

      try {
        return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(storedChallenge));
      } catch {
        return false;
      }
    };

    const secretIsValid = (() => {
      if (!client.clientSecret || !clientSecret) {
        return false;
      }

      const provided = Buffer.from(clientSecret);
      const expected = Buffer.from(client.clientSecret);
      if (provided.length !== expected.length) {
        return false;
      }

      return crypto.timingSafeEqual(provided, expected);
    })();

    const pkceIsValid = verifyPkce();

    if (client.publicClient || client.requirePkce) {
      if (!pkceIsValid) {
        return sendOauthJsonError(res, 400, 'invalid_grant', 'code_verifier invalide');
      }
    } else if (!secretIsValid && !pkceIsValid) {
      return sendOauthJsonError(res, 401, 'invalid_client', 'client_secret ou PKCE invalide');
    }

    const tokenPayload = await exchangeAuthorizationCode(pool, {
      clientId,
      code,
      redirectUri,
    });

    return res.json({
      access_token: tokenPayload.accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: tokenPayload.scopes.join(' '),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible d’échanger le code OAuth'
    );
  }
});

router.get('/userinfo', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req);
    const accountPayload = await getOauthAccountPayload(tokenRecord);
    const hasProfileRead = hasScope(tokenRecord, 'profile.read');
    const hasProfileList = hasScope(tokenRecord, 'profile.list');
    const hasProfileManage = hasScope(tokenRecord, 'profile.manage');
    const hasVipRead = hasScope(tokenRecord, 'vip.read');
    const hasVipManage = hasScope(tokenRecord, 'vip.manage');

    const response = {
      sub: `${tokenRecord.userType}:${tokenRecord.userId}`,
      user_type: tokenRecord.userType,
      user_id: tokenRecord.userId,
      client_id: tokenRecord.clientId,
      scope: tokenRecord.scopes.join(' '),
      scopes: [...tokenRecord.scopes],
      permissions: {
        profileRead: hasProfileRead,
        profileList: hasProfileList,
        profileManage: hasProfileManage,
        vipRead: hasVipRead,
        vipManage: hasVipManage,
      },
      capabilities: {
        canReadProfile: hasProfileRead,
        canListProfiles: hasProfileList || hasProfileManage,
        canManageProfiles: hasProfileManage,
        canReadVip: hasVipRead || hasVipManage,
        canManageVip: hasVipManage,
      },
    };

    if (hasProfileRead) {
      response.preferred_username = accountPayload.identity.username;
      response.picture = accountPayload.identity.avatar;
      response.name = accountPayload.identity.username;
      response.avatar = accountPayload.identity.avatar;
      response.profile = {
        username: accountPayload.identity.username,
        avatar: accountPayload.identity.avatar,
      };
    }

    if (hasProfileList || hasProfileManage) {
      const profiles = accountPayload.userData?.profiles || [];
      response.profiles = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        ageRestriction: p.ageRestriction || 0,
        isDefault: p.isDefault || false,
      }));
    }

    if (hasVipRead || hasVipManage) {
      response.vip = accountPayload.vip;
    }

    return res.json(response);
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer le profil OAuth'
    );
  }
});

router.get('/vip/status', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.read']);
    const accountPayload = await getOauthAccountPayload(tokenRecord);
    return res.json({
      success: true,
      vip: accountPayload.vip,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer le statut VIP'
    );
  }
});

router.get('/vip/invoices', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoices = await listUserVipInvoices(pool, tokenRecord, {
      limit: req.query?.limit,
    });

    return res.json({
      success: true,
      invoices,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer les invoices VIP'
    );
  }
});

router.post('/vip/invoices', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoice = await createVipInvoice(
      pool,
      {
        packEur: req.body?.pack_eur || req.body?.packEur,
        paymentMethod: req.body?.payment_method || req.body?.paymentMethod,
        coin: req.body?.coin,
        recipientMode: req.body?.recipient_mode || req.body?.recipientMode,
        payerEmail: req.body?.payer_email || req.body?.payerEmail,
      },
      {
        auth: tokenRecord,
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        callbackBaseUrl: getRequestBaseUrl(req),
      }
    );

    return res.status(201).json({
      success: true,
      invoice: serializePublicInvoice(invoice),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible de créer l’invoice VIP'
    );
  }
});

router.get('/vip/invoices/:publicId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoice = await fetchInvoiceByPublicId(pool, req.params.publicId);

    if (!canAccessVipInvoice(invoice, tokenRecord)) {
      return sendOauthJsonError(res, 404, 'not_found', 'Invoice introuvable');
    }

    return res.json({
      success: true,
      invoice: serializePublicInvoice(invoice),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer cette invoice VIP'
    );
  }
});

router.post('/vip/invoices/:publicId/check', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoice = await fetchInvoiceByPublicId(pool, req.params.publicId);

    if (!canAccessVipInvoice(invoice, tokenRecord)) {
      return sendOauthJsonError(res, 404, 'not_found', 'Invoice introuvable');
    }

    const refreshedInvoice = await refreshInvoiceStatus(pool, invoice, {
      actorType: 'oauth_app',
      actorId: tokenRecord.clientId,
    });

    return res.json({
      success: true,
      invoice: serializePublicInvoice(refreshedInvoice),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 502,
      error.oauthError || 'server_error',
      error.message || 'Vérification de paiement indisponible temporairement'
    );
  }
});

// ---------------------------------------------------------------------------
// Profile endpoints (scopes: profile.list, profile.manage)
// ---------------------------------------------------------------------------

function serializeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    ageRestriction: profile.ageRestriction || 0,
    isDefault: profile.isDefault || false,
    createdAt: profile.createdAt || null,
  };
}

router.get('/profiles', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.list']);
    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = (userData.profiles || []).map(serializeProfile);

    return res.json({ success: true, profiles });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer les profils'
    );
  }
});

router.get('/profiles/:profileId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.list']);
    const profileId = ensureSafeProfileId(req.params.profileId);
    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];
    const profile = profiles.find((p) => p.id === profileId);

    if (!profile) {
      return sendOauthJsonError(res, 404, 'not_found', 'Profil introuvable');
    }

    return res.json({ success: true, profile: serializeProfile(profile) });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer ce profil'
    );
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.manage']);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';

    if (!name || !avatar) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'name et avatar sont requis');
    }

    if (!avatar.startsWith('/avatars/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'avatar doit commencer par /avatars/');
    }

    const validAgeRestrictions = [0, 7, 12, 16, 18];
    const ageRestriction = validAgeRestrictions.includes(Number(req.body?.ageRestriction))
      ? Number(req.body.ageRestriction)
      : 0;

    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];

    if (profiles.length >= 5) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'Maximum 5 profils autorisés');
    }

    const newProfile = {
      id: uuidv4(),
      name,
      avatar,
      ageRestriction,
      createdAt: new Date().toISOString(),
      isDefault: profiles.length === 0,
    };

    userData.profiles = [...profiles, newProfile];
    userData.lastUpdated = Date.now();

    const success = await writeUserData(tokenRecord.userType, tokenRecord.userId, userData);
    if (!success) {
      return sendOauthJsonError(res, 500, 'server_error', 'Impossible de créer le profil');
    }

    return res.status(201).json({ success: true, profile: serializeProfile(newProfile) });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de créer le profil'
    );
  }
});

router.put('/profiles/:profileId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.manage']);
    const profileId = ensureSafeProfileId(req.params.profileId);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';
    const ageRestriction = req.body?.ageRestriction;

    if (!name && !avatar && ageRestriction === undefined) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'name, avatar ou ageRestriction requis');
    }

    if (avatar && !avatar.startsWith('/avatars/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'avatar doit commencer par /avatars/');
    }

    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];
    const profileIndex = profiles.findIndex((p) => p.id === profileId);

    if (profileIndex === -1) {
      return sendOauthJsonError(res, 404, 'not_found', 'Profil introuvable');
    }

    if (name) profiles[profileIndex].name = name;
    if (avatar) profiles[profileIndex].avatar = avatar;
    if (ageRestriction !== undefined) {
      const validAgeRestrictions = [0, 7, 12, 16, 18];
      profiles[profileIndex].ageRestriction = validAgeRestrictions.includes(Number(ageRestriction))
        ? Number(ageRestriction)
        : 0;
    }

    userData.profiles = profiles;
    userData.lastUpdated = Date.now();

    const success = await writeUserData(tokenRecord.userType, tokenRecord.userId, userData);
    if (!success) {
      return sendOauthJsonError(res, 500, 'server_error', 'Impossible de mettre à jour le profil');
    }

    return res.json({ success: true, profile: serializeProfile(profiles[profileIndex]) });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de mettre à jour ce profil'
    );
  }
});

router.delete('/profiles/:profileId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.manage']);
    const profileId = ensureSafeProfileId(req.params.profileId);
    const { USERS_DIR } = require('./sync');

    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];
    const profileIndex = profiles.findIndex((p) => p.id === profileId);

    if (profileIndex === -1) {
      return sendOauthJsonError(res, 404, 'not_found', 'Profil introuvable');
    }

    const isLastProfile = profiles.length <= 1;
    const wasDefault = profiles[profileIndex].isDefault;
    profiles.splice(profileIndex, 1);

    if (isLastProfile) {
      const newDefaultProfile = {
        id: uuidv4(),
        name: 'Profil',
        avatar: '/avatars/disney/disney_avatar_1.png',
        createdAt: new Date().toISOString(),
        isDefault: true,
      };
      profiles.push(newDefaultProfile);
    } else if (wasDefault && profiles.length > 0) {
      profiles[0].isDefault = true;
    }

    userData.profiles = profiles;
    userData.lastUpdated = Date.now();

    const success = await writeUserData(tokenRecord.userType, tokenRecord.userId, userData);
    if (!success) {
      return sendOauthJsonError(res, 500, 'server_error', 'Impossible de supprimer le profil');
    }

    // Supprimer le fichier de données du profil
    const fsp = require('fs').promises;
    const profilePath = getProfileFilePath(USERS_DIR, tokenRecord.userType, tokenRecord.userId, profileId);
    try { await fsp.unlink(profilePath); } catch { /* Fichier inexistant */ }

    // Supprimer les votes associés
    try {
      const pool = getPool();
      if (pool) {
        await pool.execute(
          'DELETE FROM likes WHERE user_id = ? AND user_type = ? AND profile_id = ?',
          [tokenRecord.userId, tokenRecord.userType, profileId]
        );
      }
    } catch { /* Ignorer */ }

    return res.json({
      success: true,
      newDefaultProfile: isLastProfile ? serializeProfile(profiles[profiles.length - 1]) : null,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de supprimer ce profil'
    );
  }
});

module.exports = router;
