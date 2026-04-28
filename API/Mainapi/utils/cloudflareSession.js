/**
 * Cloudflare Session Manager for Wiflix — FlareSolverr edition.
 *
 * Uses an external FlareSolverr instance to solve Cloudflare challenges.
 * Stores the session (cookies, User-Agent) in Redis so every cluster
 * worker can reuse it. Only one worker triggers a solve at a time
 * (Redis distributed lock).
 *
 * FlareSolverr manages its own browser — no Puppeteer/Chromium needed here.
 *
 * Env: FLARESOLVERR_URL (default http://localhost:8191)
 */

const axios = require('axios');
const { redis } = require('../config/redis');
const { acquireRedisLock } = require('./redisLock');

// Config
const FLARESOLVERR_URL = (process.env.FLARESOLVERR_URL || 'http://localhost:8191').replace(/\/+$/, '');
const SESSION_NAME = 'movix_wiflix';
const SESSION_TTL_MS = 13 * 60 * 1000;  // 13 min
const SESSION_REDIS_TTL_S = 15 * 60;    // 15 min in Redis (margin)
const FLARESOLVERR_TIMEOUT = 60000;      // 60s for challenge solving
const REDIS_SESSION_KEY = 'cf_session:wiflix:v2';
const REDIS_LOCK_KEY = 'cf_session:wiflix:solve_lock';

// Proxy — first SOCKS5 proxy from env
function getProxyConfig() {
  try {
    const proxies = JSON.parse(process.env.SOCKS5_PROXIES || '[]');
    if (proxies.length > 0) {
      const p = proxies[0];
      const url = `socks5://${p.auth}@${p.host}:${p.port}`;
      return { url };
    }
  } catch {}
  return null;
}
const PROXY = getProxyConfig();

// ─── FlareSolverr API helpers ────────────────────────────────────────────────

async function flaresolverrPost(body) {
  const res = await axios.post(`${FLARESOLVERR_URL}/v1`, body, {
    timeout: FLARESOLVERR_TIMEOUT,
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

async function createSession() {
  try {
    const body = { cmd: 'sessions.create', session: SESSION_NAME };
    if (PROXY) body.proxy = PROXY;
    await flaresolverrPost(body);
    console.log(`[CF SESSION] Session FlareSolverr "${SESSION_NAME}" creee${PROXY ? ` (proxy: ${PROXY.url})` : ''}`);
  } catch (err) {
    // Session might already exist — ignore 500 "already exists"
    if (err.response?.data?.message?.includes('already exists')) {
      console.log(`[CF SESSION] Session FlareSolverr "${SESSION_NAME}" existe deja`);
      return;
    }
    throw err;
  }
}

async function destroySession() {
  try {
    await flaresolverrPost({ cmd: 'sessions.destroy', session: SESSION_NAME });
  } catch { /* ignore */ }
}

// ─── Redis session store ─────────────────────────────────────────────────────

async function loadSessionFromRedis() {
  try {
    const raw = await redis.get(REDIS_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.cookies || !session.userAgent || !session.solvedAt) return null;
    if ((Date.now() - session.solvedAt) >= SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

async function saveSessionToRedis(session) {
  try {
    await redis.set(REDIS_SESSION_KEY, JSON.stringify(session), 'EX', SESSION_REDIS_TTL_S);
  } catch (err) {
    console.warn('[CF SESSION] Erreur sauvegarde Redis:', err.message);
  }
}

async function deleteSessionFromRedis() {
  try { await redis.del(REDIS_SESSION_KEY); } catch {}
}

// ─── Challenge solver ────────────────────────────────────────────────────────

async function _doSolve(targetUrl) {
  console.log(`[CF SESSION] Resolution du challenge via FlareSolverr pour ${targetUrl}...`);

  // Recreate session to get a fresh browser state
  await destroySession();
  await createSession();

  const requestBody = {
    cmd: 'request.get',
    url: targetUrl,
    session: SESSION_NAME,
    maxTimeout: FLARESOLVERR_TIMEOUT,
  };
  if (PROXY) requestBody.proxy = PROXY;
  const result = await flaresolverrPost(requestBody);

  const solution = result.solution;
  if (!solution || solution.status >= 400) {
    throw new Error(`FlareSolverr a echoue: status=${solution?.status || 'unknown'}`);
  }

  const cookies = solution.cookies || [];
  const userAgent = solution.userAgent || '';

  const cfClearance = cookies.find(c => c.name === 'cf_clearance');
  if (!cfClearance) {
    console.warn('[CF SESSION] Cookie cf_clearance non trouve dans la reponse FlareSolverr');
  } else {
    console.log('[CF SESSION] cf_clearance obtenu via FlareSolverr');
  }

  const session = {
    cookies,
    userAgent,
    solvedAt: Date.now(),
  };

  await saveSessionToRedis(session);
  console.log(`[CF SESSION] Session sauvegardee dans Redis (${cookies.length} cookies)`);

  return session;
}

/**
 * Ensure a valid session exists. Uses Redis lock so only one worker
 * across the cluster triggers a solve at a time.
 */
async function ensureSession(targetUrl) {
  // 1. Check Redis for existing valid session
  const existing = await loadSessionFromRedis();
  if (existing) return existing;

  // 2. Acquire lock — only one worker solves
  const lock = await acquireRedisLock(REDIS_LOCK_KEY, {
    ttl: 90,
    retries: 70,
    retryDelay: 1000,
  });

  if (!lock) {
    const retry = await loadSessionFromRedis();
    if (retry) return retry;
    console.warn('[CF SESSION] Impossible d\'acquerir le lock et aucune session en Redis');
    return null;
  }

  try {
    // Re-check after acquiring lock
    const doubleCheck = await loadSessionFromRedis();
    if (doubleCheck) return doubleCheck;

    return await _doSolve(targetUrl);
  } finally {
    await lock.release();
  }
}

/**
 * Invalidate the session (all workers).
 */
async function invalidateSession() {
  await deleteSessionFromRedis();
  console.log('[CF SESSION] Session invalidee dans Redis');
}

// ─── Request helper ──────────────────────────────────────────────────────────

function buildHeaders(session, extraHeaders = {}) {
  const cookieStr = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  return {
    'User-Agent': session.userAgent,
    'Cookie': cookieStr,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    ...extraHeaders,
  };
}

/**
 * Make an axios request using the Cloudflare session cookies.
 * Automatically re-solves on 403 / challenge page and retries once.
 */
async function requestWithSession(axiosInstance, baseUrl, config) {
  const session = await ensureSession(baseUrl);
  if (!session) {
    throw new Error('Aucune session Cloudflare disponible');
  }

  const mergedConfig = {
    ...config,
    headers: buildHeaders(session, config.headers || {}),
  };

  try {
    const response = await axiosInstance(mergedConfig);

    if (typeof response.data === 'string' && response.data.includes("Un instant, s'il vous plait")) {
      console.log('[CF SESSION] Challenge detecte dans la reponse, re-resolution...');
      await invalidateSession();
      const newSession = await ensureSession(baseUrl);
      if (!newSession) throw new Error('Re-resolution echouee');
      return await axiosInstance({
        ...config,
        headers: buildHeaders(newSession, config.headers || {}),
      });
    }

    return response;
  } catch (err) {
    if (err.response && err.response.status === 403) {
      console.log('[CF SESSION] 403 recu, re-resolution du challenge...');
      await invalidateSession();
      const newSession = await ensureSession(baseUrl);
      if (!newSession) throw new Error('Re-resolution echouee');
      return await axiosInstance({
        ...config,
        headers: buildHeaders(newSession, config.headers || {}),
      });
    }
    throw err;
  }
}

module.exports = {
  ensureSession,
  invalidateSession,
  requestWithSession,
};
