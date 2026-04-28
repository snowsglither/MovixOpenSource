const fs = require('fs');
const path = require('path');

const OAUTH_CLIENTS_FILE = path.join(__dirname, '..', 'data', 'oauth-clients.json');
const OAUTH_CLIENTS_ENV = 'MOVIX_OAUTH_CLIENTS_JSON';
const KNOWN_OAUTH_SCOPES = ['profile.read', 'profile.list', 'profile.manage', 'vip.read', 'vip.manage'];
const DEFAULT_SCOPE = 'profile.read';
const OAUTH_DEBUG_ENABLED = process.env.MOVIX_OAUTH_DEBUG === 'true';

let cache = {
  fileMtimeMs: -1,
  envRaw: null,
  clients: [],
};

function safeJsonParse(rawValue, fallback) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    console.error('[OAuth Clients] Invalid JSON payload:', error.message || error);
    return fallback;
  }
}

function normalizeHttpUrl(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = new URL(rawValue.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalizedHostname = String(hostname || '').toLowerCase();
  return normalizedHostname === 'localhost'
    || normalizedHostname === '127.0.0.1'
    || normalizedHostname === '::1'
    || normalizedHostname === '[::1]'
    || normalizedHostname.endsWith('.localhost');
}

function normalizeRedirectUri(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = new URL(rawValue.trim());
    const isLoopbackHost = isLoopbackHostname(parsed.hostname);

    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost)) {
      return null;
    }

    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizePathname(pathname) {
  const normalizedPathname = String(pathname || '/').trim() || '/';
  return normalizedPathname.replace(/\/+$/g, '') || '/';
}

function getLoopbackRedirectPaths(client) {
  if (!client || !Array.isArray(client.redirectUris)) {
    return [];
  }

  return uniqueStrings(
    client.redirectUris
      .map((redirectUri) => {
        try {
          const parsed = new URL(redirectUri);
          return isLoopbackHostname(parsed.hostname) ? normalizePathname(parsed.pathname) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

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

function normalizeScopes(rawScopes) {
  const sourceValues = Array.isArray(rawScopes)
    ? rawScopes
    : typeof rawScopes === 'string'
      ? rawScopes.split(/\s+/)
      : [];

  return uniqueStrings(
    sourceValues
      .map((scope) => String(scope || '').trim())
      .filter((scope) => KNOWN_OAUTH_SCOPES.includes(scope))
  );
}

function normalizeClient(rawClient) {
  if (!rawClient || typeof rawClient !== 'object' || Array.isArray(rawClient)) {
    return null;
  }

  const clientId = String(rawClient.clientId || '').trim();
  const clientName = String(rawClient.clientName || '').trim();
  const redirectUris = uniqueStrings(
    (Array.isArray(rawClient.redirectUris) ? rawClient.redirectUris : [])
      .map(normalizeRedirectUri)
      .filter(Boolean)
  );

  if (!clientId || !clientName || redirectUris.length === 0) {
    return null;
  }

  const clientSecret = typeof rawClient.clientSecret === 'string' && rawClient.clientSecret.trim()
    ? rawClient.clientSecret.trim()
    : null;
  const publicClient = rawClient.publicClient === true || !clientSecret;
  const requirePkce = rawClient.requirePkce === true || publicClient;
  const allowedScopes = normalizeScopes(rawClient.allowedScopes);
  const homepageUrl = normalizeHttpUrl(rawClient.homepageUrl);
  const logoUrl = normalizeHttpUrl(rawClient.logoUrl);
  const description = typeof rawClient.description === 'string' && rawClient.description.trim()
    ? rawClient.description.trim()
    : null;

  return {
    clientId,
    clientName,
    clientSecret,
    publicClient,
    requirePkce,
    redirectUris,
    allowedScopes: allowedScopes.length > 0 ? allowedScopes : [DEFAULT_SCOPE],
    homepageUrl,
    logoUrl,
    description,
  };
}

function readClientsFile() {
  try {
    if (!fs.existsSync(OAUTH_CLIENTS_FILE)) {
      return [];
    }

    const fileContent = fs.readFileSync(OAUTH_CLIENTS_FILE, 'utf8');
    const parsed = safeJsonParse(fileContent, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[OAuth Clients] Failed to read oauth-clients.json:', error.message || error);
    return [];
  }
}

function getClientsFileMtimeMs() {
  try {
    if (!fs.existsSync(OAUTH_CLIENTS_FILE)) {
      return -1;
    }

    return fs.statSync(OAUTH_CLIENTS_FILE).mtimeMs || -1;
  } catch {
    return -1;
  }
}

function loadOAuthClients() {
  const envRaw = process.env[OAUTH_CLIENTS_ENV] || '';
  const fileMtimeMs = getClientsFileMtimeMs();

  if (cache.envRaw === envRaw && cache.fileMtimeMs === fileMtimeMs) {
    return cache.clients;
  }

  const fromEnv = safeJsonParse(envRaw, []);
  const fromFile = readClientsFile();
  const mergedSources = [
    ...(Array.isArray(fromEnv) ? fromEnv : []),
    ...(Array.isArray(fromFile) ? fromFile : []),
  ];

  const byClientId = new Map();
  mergedSources.forEach((entry) => {
    const normalized = normalizeClient(entry);
    if (!normalized) {
      return;
    }

    byClientId.set(normalized.clientId, normalized);
  });

  cache = {
    envRaw,
    fileMtimeMs,
    clients: Array.from(byClientId.values()),
  };

  return cache.clients;
}

function getOAuthClient(clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return null;
  }

  return loadOAuthClients().find((client) => client.clientId === normalizedClientId) || null;
}

function getOAuthClientPublicMetadata(client) {
  if (!client) {
    return null;
  }

  return {
    clientId: client.clientId,
    clientName: client.clientName,
    description: client.description,
    homepageUrl: client.homepageUrl,
    logoUrl: client.logoUrl,
    publicClient: client.publicClient,
    requirePkce: client.requirePkce,
    allowedScopes: [...client.allowedScopes],
    redirectOrigins: uniqueStrings(
      client.redirectUris
        .map((redirectUri) => {
          try {
            return new URL(redirectUri).origin;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    ),
  };
}

function resolveClientRedirectUri(client, requestedRedirectUri) {
  if (!client) {
    const error = new Error('Client OAuth introuvable');
    error.statusCode = 400;
    error.oauthError = 'invalid_client';
    throw error;
  }

  if (!requestedRedirectUri) {
    if (client.redirectUris.length === 1) {
      logOauthDebug('redirect_uri absent, using the only registered redirect URI', {
        clientId: client.clientId,
        redirectUri: client.redirectUris[0],
      });
      return client.redirectUris[0];
    }

    const loopbackPaths = getLoopbackRedirectPaths(client);
    const allLoopback = client.redirectUris.every((uri) => {
      try {
        return isLoopbackHostname(new URL(uri).hostname);
      } catch {
        return false;
      }
    });

    if (allLoopback && loopbackPaths.length === 1) {
      logOauthDebug('redirect_uri absent, all registered URIs are loopback with same path, using first', {
        clientId: client.clientId,
        redirectUri: client.redirectUris[0],
        loopbackPath: loopbackPaths[0],
      });
      return client.redirectUris[0];
    }
  }

  const normalizedRedirectUri = normalizeRedirectUri(requestedRedirectUri);
  logOauthDebug('Validating redirect_uri', {
    clientId: client.clientId,
    requestedRedirectUri,
    normalizedRedirectUri,
    registeredRedirectUris: client.redirectUris,
    loopbackRedirectPaths: getLoopbackRedirectPaths(client),
  });

  if (!normalizedRedirectUri) {
    logOauthDebug('redirect_uri rejected because normalization failed', {
      clientId: client.clientId,
      requestedRedirectUri,
    });
    const error = new Error('redirect_uri non autorisée');
    error.statusCode = 400;
    error.oauthError = 'invalid_request';
    throw error;
  }

  if (client.redirectUris.includes(normalizedRedirectUri)) {
    logOauthDebug('redirect_uri matched an exact registered URI', {
      clientId: client.clientId,
      normalizedRedirectUri,
    });
    return normalizedRedirectUri;
  }

  let isLoopbackPathAllowed = false;
  try {
    const parsedRequestedRedirectUri = new URL(normalizedRedirectUri);
    if (isLoopbackHostname(parsedRequestedRedirectUri.hostname)) {
      const requestedPathname = normalizePathname(parsedRequestedRedirectUri.pathname);
      const loopbackRedirectPaths = getLoopbackRedirectPaths(client);

      if (loopbackRedirectPaths.includes(requestedPathname)) {
        isLoopbackPathAllowed = true;
        logOauthDebug('redirect_uri accepted via loopback path match', {
          clientId: client.clientId,
          requestedRedirectUri: normalizedRedirectUri,
          requestedPathname,
          loopbackRedirectPaths,
        });
      }
    }
  } catch {
    // Ignore malformed URLs already rejected above.
  }

  if (isLoopbackPathAllowed) {
    return normalizedRedirectUri;
  }

  if (!client.redirectUris.includes(normalizedRedirectUri)) {
    logOauthDebug('redirect_uri rejected after validation', {
      clientId: client.clientId,
      requestedRedirectUri: normalizedRedirectUri,
      registeredRedirectUris: client.redirectUris,
    });
    const error = new Error('redirect_uri non autorisée');
    error.statusCode = 400;
    error.oauthError = 'invalid_request';
    throw error;
  }

  return normalizedRedirectUri;
}

function normalizeRequestedScopes(requestedScopes, client) {
  if (!client) {
    const error = new Error('Client OAuth introuvable');
    error.statusCode = 400;
    error.oauthError = 'invalid_client';
    throw error;
  }

  const scopes = normalizeScopes(requestedScopes);
  const normalizedScopes = scopes.length > 0
    ? scopes
    : client.allowedScopes.includes(DEFAULT_SCOPE)
      ? [DEFAULT_SCOPE]
      : client.allowedScopes.slice(0, 1);

  if (normalizedScopes.length === 0) {
    const error = new Error('Aucune permission OAuth disponible pour ce client');
    error.statusCode = 400;
    error.oauthError = 'invalid_scope';
    throw error;
  }

  const invalidScopes = normalizedScopes.filter((scope) => !client.allowedScopes.includes(scope));
  if (invalidScopes.length > 0) {
    const error = new Error(`Scopes non autorisées: ${invalidScopes.join(', ')}`);
    error.statusCode = 400;
    error.oauthError = 'invalid_scope';
    throw error;
  }

  return normalizedScopes;
}

function getOAuthAllowedCorsOrigins() {
  const origins = new Set();

  loadOAuthClients().forEach((client) => {
    client.redirectUris.forEach((redirectUri) => {
      try {
        origins.add(new URL(redirectUri).origin);
      } catch {
        // Ignore malformed values already filtered during normalization.
      }
    });
  });

  return Array.from(origins);
}

module.exports = {
  KNOWN_OAUTH_SCOPES,
  DEFAULT_SCOPE,
  loadOAuthClients,
  getOAuthClient,
  getOAuthClientPublicMetadata,
  resolveClientRedirectUri,
  normalizeRequestedScopes,
  getOAuthAllowedCorsOrigins,
};
