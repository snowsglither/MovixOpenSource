/**
 * DarkiWorld routes module.
 * Extracted from server.js -- handles DarkiWorld download links, decoding,
 * seasons and episodes retrieval.
 *
 * Mounted at /api/darkiworld  (paths below are relative to that prefix).
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fsp = require('fs').promises;
const { generateCacheKey } = require('../utils/cacheManager');
const { getAuthIfValid } = require('../middleware/auth');
const { getPool: getMovixPool } = require('../mysqlPool');
const hydrackerQueue = require('../utils/hydrackerQueue');

// TTL pour les échecs de /decode (ex. "Lien d'embed invalide" persistant côté
// upstream). On stocke un marker `{ failed: true, failedAt }` au lieu du
// cachedData habituel, pour servir directement un 404 pendant ce délai sans
// re-taper hydracker.com à chaque clic.
const DECODE_FAILED_TTL_MS = 2 * 60 * 60 * 1000;

const HOST_ICON_MAP = {
  '1fichier': '/hosts/1fichier.svg',
  'Mega': '/hosts/mega.svg',
  'Uploaded': '/hosts/uploaded.svg',
  'RapidGator': '/hosts/rapidgator.svg',
  'Google Drive': '/hosts/gdrive.svg',
  'Dropbox': '/hosts/dropbox.svg',
};

async function resolveMovixUsername(userId, authType) {
  try {
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeUserType = authType === 'bip-39' ? 'bip39' : 'oauth';
    const userPath = path.join(__dirname, '..', 'data', 'users', safeUserType, `${safeUserId}.json`);
    const data = JSON.parse(await fsp.readFile(userPath, 'utf8'));
    if (data.profiles && data.profiles.length > 0) {
      return { username: data.profiles[0].name || 'Admin', avatar: data.profiles[0].avatar || null };
    }
  } catch { /* fall through */ }
  return { username: 'Admin', avatar: null };
}

async function fetchMovixDownloadLinks(type, id, season, episode) {
  const pool = getMovixPool();
  let raw = [];
  if (type === 'movie') {
    const [rows] = await pool.execute('SELECT download_links FROM films WHERE id = ?', [id]);
    raw = rows[0]?.download_links
      ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
      : [];
  } else {
    const seasonNum = Number(season);
    const episodeNum = Number(episode);
    const [episodeRows] = await pool.execute(
      'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
      [id, seasonNum, episodeNum]
    );
    const [seasonRows] = await pool.execute(
      'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = 0',
      [id, seasonNum]
    );
    const parse = (rows) => rows[0]?.download_links
      ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
      : [];
    raw = [...parse(episodeRows), ...parse(seasonRows)];
  }

  const normalized = await Promise.all(raw.map(async (l) => {
    const addedBy = l.added_by || {};
    const userInfo = addedBy.id
      ? await resolveMovixUsername(addedBy.id, addedBy.auth_type)
      : { username: 'Admin', avatar: null };
    const isFullSeason = Boolean(l.full_saison);
    return {
      source: 'movix',
      id: `movix:${l.url}`,
      url: l.url,
      host_id: -1,
      host_name: l.host || 'Movix',
      host_icon: HOST_ICON_MAP[l.host] || null,
      provider: 'movix',
      language: l.language,
      quality: l.quality,
      sub: Boolean(l.sub),
      size: l.size || '',
      full_saison: isFullSeason ? 1 : undefined,
      saison: type === 'tv' ? Number(season) : undefined,
      episode: type === 'tv' ? (isFullSeason ? 0 : Number(episode)) : undefined,
      added_at: l.added_at || null,
      added_by: { username: userInfo.username, avatar: userInfo.avatar },
    };
  }));

  return normalized;
}

// ---------------------------------------------------------------------------
// Dependencies injected via configure()
// ---------------------------------------------------------------------------
let DARKINO_MAINTENANCE;
let DOWNLOAD_CACHE_DIR;
let darkiHeaders;
let axiosDarkinoRequest;
let getFromCacheNoExpiration;
let saveToCache;
let shouldUpdateCache;
let shouldUpdateCache24h;
let refreshDarkinoSessionIfNeeded;
let redis;
let shouldUpdateCache48h;

/**
 * Inject runtime dependencies that still live in server.js.
 */
function configure(deps) {
  if (deps.DARKINO_MAINTENANCE !== undefined) DARKINO_MAINTENANCE = deps.DARKINO_MAINTENANCE;
  if (deps.DOWNLOAD_CACHE_DIR) DOWNLOAD_CACHE_DIR = deps.DOWNLOAD_CACHE_DIR;
  if (deps.darkiHeaders) darkiHeaders = deps.darkiHeaders;
  if (deps.axiosDarkinoRequest) axiosDarkinoRequest = deps.axiosDarkinoRequest;
  if (deps.getFromCacheNoExpiration) getFromCacheNoExpiration = deps.getFromCacheNoExpiration;
  if (deps.saveToCache) saveToCache = deps.saveToCache;
  if (deps.shouldUpdateCache) shouldUpdateCache = deps.shouldUpdateCache;
  if (deps.shouldUpdateCache24h) shouldUpdateCache24h = deps.shouldUpdateCache24h;
  if (deps.refreshDarkinoSessionIfNeeded) refreshDarkinoSessionIfNeeded = deps.refreshDarkinoSessionIfNeeded;
  if (deps.redis) redis = deps.redis;
  if (deps.shouldUpdateCache48h) shouldUpdateCache48h = deps.shouldUpdateCache48h;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchLegacySeasonsPage(titleId, page, perPage) {
  const response = await axiosDarkinoRequest({
    method: 'get',
    url: `/api/v1/titles/${titleId}/seasons?perPage=${perPage}&query=&page=${page}`
  });

  return {
    success: true,
    mode: 'legacy',
    ...response.data
  };
}

async function fetchSeasonPageForCount(titleId, seasonNumbers = []) {
  const attemptedSeasonNumbers = new Set();

  for (const rawSeasonNumber of seasonNumbers) {
    const seasonNumber = parsePositiveInt(rawSeasonNumber, null);
    if (!seasonNumber || attemptedSeasonNumbers.has(seasonNumber)) {
      continue;
    }

    attemptedSeasonNumbers.add(seasonNumber);

    try {
      const response = await axiosDarkinoRequest({
        method: 'get',
        url: `/api/v1/titles/${titleId}/seasons/${seasonNumber}?loader=seasonPage`
      });

      const seasonsCount = parsePositiveInt(response.data?.title?.seasons_count, 0);
      if (seasonsCount > 0) {
        return {
          seasonsCount,
          data: response.data
        };
      }
    } catch (_) { /* upstream 404/422 expected, others swallowed */ }
  }

  return null;
}

function buildSyntheticSeasonsResponse(titleId, page, perPage, seasonPagePayload) {
  const currentPage = parsePositiveInt(page, 1);
  const itemsPerPage = parsePositiveInt(perPage, 8);
  const seasonsCount = parsePositiveInt(seasonPagePayload?.title?.seasons_count, 0);
  const selectedSeason = seasonPagePayload?.season || null;
  const selectedSeasonNumber = parsePositiveInt(selectedSeason?.number, 0);
  const lastPage = seasonsCount > 0 ? Math.ceil(seasonsCount / itemsPerPage) : 1;
  const safePage = Math.min(currentPage, lastPage);
  const startIndex = seasonsCount > 0 ? (safePage - 1) * itemsPerPage : 0;

  const allSeasons = Array.from({ length: seasonsCount }, (_, index) => {
    const seasonNumber = index + 1;
    const isSelectedSeason = selectedSeasonNumber === seasonNumber;

    return {
      id: isSelectedSeason && selectedSeason?.id ? selectedSeason.id : seasonNumber,
      poster: isSelectedSeason ? (selectedSeason?.poster || '') : '',
      release_date: isSelectedSeason
        ? (selectedSeason?.release_date || seasonPagePayload?.title?.release_date || '')
        : '',
      number: seasonNumber,
      title_id: isSelectedSeason && selectedSeason?.title_id
        ? selectedSeason.title_id
        : parsePositiveInt(titleId, 0),
      episodes_count: isSelectedSeason
        ? parsePositiveInt(selectedSeason?.episodes_count ?? selectedSeason?.episode_count, 0)
        : 0,
      model_type: isSelectedSeason ? (selectedSeason?.model_type || 'season') : 'season',
      first_episode: isSelectedSeason ? (selectedSeason?.first_episode || null) : null
    };
  });

  const data = allSeasons.slice(startIndex, startIndex + itemsPerPage);
  const from = data.length > 0 ? startIndex + 1 : 0;
  const to = data.length > 0 ? startIndex + data.length : 0;

  return {
    success: true,
    mode: 'seasonPage',
    title: seasonPagePayload?.title || null,
    loader: seasonPagePayload?.loader || 'seasonPage',
    pagination: {
      current_page: safePage,
      data,
      from,
      last_page: lastPage,
      next_page: safePage < lastPage ? safePage + 1 : null,
      per_page: itemsPerPage,
      prev_page: safePage > 1 ? safePage - 1 : null,
      to,
      total: seasonsCount
    }
  };
}

async function fetchSeasonsCountResponse(titleId, page, perPage) {
  let seasonPageResult = await fetchSeasonPageForCount(titleId, [1]);

  if (!seasonPageResult) {
    try {
      const legacyBootstrap = await fetchLegacySeasonsPage(titleId, 1, 1);
      const firstLegacySeasonNumber = legacyBootstrap?.pagination?.data?.[0]?.number;
      seasonPageResult = await fetchSeasonPageForCount(titleId, [firstLegacySeasonNumber]);
    } catch (_) { /* upstream missing, fall through to legacy path */ }
  }

  if (!seasonPageResult) {
    return null;
  }

  return buildSyntheticSeasonsResponse(titleId, page, perPage, seasonPageResult.data);
}

// ---------------------------------------------------------------------------
// findAllEntriesForEpisode -- paginate DarkiWorld API to find all entries
// Utilise le nouvel endpoint authentifié `/api/v1/titles/{X}/content/liens`.
// Auth = cookies + XSRF token injectés par buildDarkinoRequestHeaders depuis
// les env DARKIWORLD_COOKIES / DARKIWORLD_XSRF_TOKEN (voir app.js darkiHeaders).
// ---------------------------------------------------------------------------
async function findAllEntriesForEpisode({ titleId, seasonId, episodeId, perPage = 100, maxPages = 10 }) {
  // Rafraîchir les cookies avant de commencer la pagination
  try {
    await refreshDarkinoSessionIfNeeded();
  } catch (_) { /* session refresh non-fatal */ }

  let page = 1;
  let foundEntries = [];
  let shouldContinue = true;

  while (shouldContinue && page <= maxPages) {
    const url = `/api/v1/titles/${titleId}/content/liens?perPage=${perPage}&page=${page}&loader=linksdl&season=${seasonId}&filters=&paginate=preferLengthAware`;
    try {
      const resp = await axiosDarkinoRequest({
        method: 'get',
        url: url,
        headers: darkiHeaders
      });

      const data = resp.data?.pagination?.data || [];

      // Chercher toutes les entrées correspondant à l'épisode ET les liens de saison complète
      const matching = data.filter(entry =>
        entry.host &&
        (
          // Liens d'épisode spécifique
          (entry.episode_id == episodeId || entry.episode == episodeId || entry.episode_number == episodeId) ||
          // Liens de saison complète (full_saison = 1)
          entry.full_saison == 1
        )
      );

      if (matching.length > 0) {
        foundEntries = [...foundEntries, ...matching];
      }

      // Pagination intelligente
      const nextPage = resp.data?.pagination?.next_page;
      if (!nextPage) {
        shouldContinue = false;
      } else {
        page = nextPage;
      }
    } catch (_) {
      shouldContinue = false;
    }
  }

  return foundEntries;
}

// ---------------------------------------------------------------------------
// GET /download/:type/:id
// Récupérer tous les liens d'amélioration DarkiWorld pour un film ou un épisode
// Params: type (movie/tv), id (TMDB ID)
// Query: season (optionnel pour les séries), episode (optionnel pour les séries)
// ---------------------------------------------------------------------------
router.get('/download/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { season, episode, tmdbId } = req.query;

    // Validation
    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Type invalide. Utilisez "movie" ou "tv"'
      });
    }

    if (type === 'tv' && (!season || !episode)) {
      return res.status(400).json({
        success: false,
        error: 'Pour les séries, les paramètres season et episode sont requis'
      });
    }

    // Generate cache key — v2 invalide les caches sans champ `lien` direct.
    const cacheKey = generateCacheKey(`darkiworld_download_v2_${type}_${id}${type === 'tv' ? `_${season}_${episode}` : ''}`);

    // Movix admin links are stored by TMDB id, while the path :id is the
    // DarkiWorld title id used for the upstream DarkiWorld API call. Use the
    // tmdbId query param when provided; fall back to the path id (legacy
    // clients without tmdbId will still work but won't get Movix links).
    const movixLookupId = tmdbId ? String(tmdbId) : id;

    // Fetch Movix admin links (always, regardless of DarkiWorld cache state)
    const movixLinks = await fetchMovixDownloadLinks(type, movixLookupId, season, episode);

    // Check if results are in cache without expiration (stale-while-revalidate)
    const cachedData = await getFromCacheNoExpiration(DOWNLOAD_CACHE_DIR, cacheKey);
    let dataReturned = false;

    if (cachedData) {
      // console.log(`Résultats de téléchargement pour ${type}/${id} récupérés du cache`);
      const cachedAll = Array.isArray(cachedData?.all) ? cachedData.all.map(r => ({ ...r, source: r.source || 'darkiworld' })) : [];
      res.status(200).json({ ...cachedData, all: [...movixLinks, ...cachedAll], movixCount: movixLinks.length });
      dataReturned = true;
    }

    // Vérifier si l'utilisateur a accès premium (optionnel)
    const auth = await getAuthIfValid(req);
    const darkiworld_premium = auth && auth.userType === 'premium';

    let allEnhancementLinks = [];

    if (type === 'movie') {
      // Pour les films
      try {
        await refreshDarkinoSessionIfNeeded();
        // 1. Récupérer tous les liens pour le film via le nouvel endpoint
        // authentifié /api/v1/titles/{id}/content/liens. Auth (cookies + XSRF
        // token) injectée par buildDarkinoRequestHeaders depuis les env
        // DARKIWORLD_COOKIES / DARKIWORLD_XSRF_TOKEN.
        const liensResp = await axiosDarkinoRequest({
          method: 'get',
          url: `/api/v1/titles/${id}/content/liens?perPage=100&loader=linksdl&filters=&paginate=preferLengthAware`
        });

        const allEntries = liensResp.data?.pagination?.data || [];

        // Traiter directement les entrées sans faire de requête de décodage
        const enhancementSources = allEntries.map(entry => {
          if (!entry) return null;

          const hostInfo = entry.host;
          const provider = hostInfo?.name || 'unknown';

          return {
            id: entry.id,
            language: (entry?.langues_compact && entry.langues_compact.length > 0)
              ? entry.langues_compact.map(l => l.name).join(', ')
              : undefined,
            quality: entry?.qual?.qual,
            sub: (entry?.subs_compact && entry.subs_compact.length > 0)
              ? entry.subs_compact.map(s => s.name).join(', ')
              : undefined,
            provider: provider,
            host_id: hostInfo?.id_host,
            host_name: hostInfo?.name,
            size: entry?.taille,
            upload_date: entry?.created_at,
            host_icon: hostInfo?.icon,
            view: entry?.view
          };
        });

        allEnhancementLinks = enhancementSources.filter(Boolean);
      } catch (_) { /* upstream failure leaves allEnhancementLinks empty */ }

    } else {
      // Pour les séries (épisodes)
      try {
        // 1. Paginer intelligemment pour trouver l'épisode
        const allEntries = await findAllEntriesForEpisode({
          titleId: id,
          seasonId: parseInt(season),
          episodeId: parseInt(episode),
          perPage: 100,
          maxPages: 10
        });

        // Traiter directement les entrées sans faire de requête de décodage
        const enhancementSources = allEntries.map(entry => {
          if (!entry) return null;

          const hostInfo = entry.host;
          const provider = hostInfo?.name || 'unknown';

          return {
            id: entry.id,
            language: (entry?.langues_compact && entry.langues_compact.length > 0)
              ? entry.langues_compact.map(l => l.name).join(', ')
              : undefined,
            quality: entry?.qual?.qual,
            sub: (entry?.subs_compact && entry.subs_compact.length > 0)
              ? entry.subs_compact.map(s => s.name).join(', ')
              : undefined,
            provider: provider,
            host_id: hostInfo?.id_host,
            host_name: hostInfo?.name,
            size: entry?.taille,
            upload_date: entry?.created_at,
            episode_id: entry?.episode_id,
            episode_number: entry?.episode_number,
            host_icon: hostInfo?.icon,
            view: entry?.view,
            saison: entry?.saison,
            episode: entry?.episode,
            full_saison: entry?.full_saison
          };
        });

        allEnhancementLinks = enhancementSources.filter(Boolean);
      } catch (_) { /* upstream failure leaves allEnhancementLinks empty */ }
    }

    const taggedDarkiLinks = allEnhancementLinks.map(r => ({ ...r, source: 'darkiworld' }));
    const responseData = {
      success: true,
      all: [...movixLinks, ...taggedDarkiLinks],
      movixCount: movixLinks.length
    };

    // Si on n'a pas encore retourné de données, retourner maintenant
    if (!dataReturned) {
      res.json(responseData);
    }

    // Background update du cache
    (async () => {
      try {
        // Vérifier si le cache doit être mis à jour
        const shouldUpdate = await shouldUpdateCache(DOWNLOAD_CACHE_DIR, cacheKey);
        if (!shouldUpdate) {
          return; // Ne pas mettre à jour le cache
        }

        // Si on a des données, sauvegarder dans le cache
        if (allEnhancementLinks && allEnhancementLinks.length > 0) {
          // Store only DarkiWorld entries in cache — Movix links are fetched fresh each request
          const darkiOnlyData = {
            success: true,
            all: allEnhancementLinks.map(r => ({ ...r, source: 'darkiworld' }))
          };
          await saveToCache(DOWNLOAD_CACHE_DIR, cacheKey, darkiOnlyData);
        }
      } catch (cacheError) {
        // Silent fail on cache save
      }
    })();

  } catch (error) {
    // Si Darkino retourne 500, ne pas créer/mettre à jour le cache et renvoyer le cache existant si présent
    if (error.response && error.response.status >= 500) {
      try {
        const fallbackCache = await getFromCacheNoExpiration(DOWNLOAD_CACHE_DIR, cacheKey);
        if (fallbackCache) {
          const fbAll = Array.isArray(fallbackCache?.all) ? fallbackCache.all.map(r => ({ ...r, source: r.source || 'darkiworld' })) : [];
          return res.status(200).json({ ...fallbackCache, all: [...movixLinks, ...fbAll], movixCount: movixLinks.length });
        }
      } catch (_) { }
    }

    if (!res.headersSent) {
      // If Movix links exist, still return them with a warning
      let movixFallback = [];
      try {
        const fallbackLookupId = req.query.tmdbId ? String(req.query.tmdbId) : req.params.id;
        movixFallback = await fetchMovixDownloadLinks(type, fallbackLookupId, req.query.season, req.query.episode);
      } catch (_) { /* ignore */ }
      if (movixFallback.length > 0) {
        return res.status(200).json({
          success: true,
          all: movixFallback,
          movixCount: movixFallback.length,
          warning: 'DarkiWorld unavailable'
        });
      }
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des liens d\'amélioration DarkiWorld',
        message: error.message
      });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /decode/:id
// Extraire le lien décodé (m3u8) pour un ID de lien DarkiWorld
// Params: id (ID du lien DarkiWorld)
// ---------------------------------------------------------------------------
router.get('/decode/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'ID du lien requis' });

    if (DARKINO_MAINTENANCE) {
      return res.status(200).json({ error: 'Service Darkino temporairement indisponible (maintenance)' });
    }

    const result = await hydrackerQueue.decodeRequest(id, {
      redis,
      cacheDir: DOWNLOAD_CACHE_DIR,
      generateCacheKey,
      getFromCacheNoExpiration,
      shouldUpdateCache48h
    });

    if (result.payload) return res.status(200).json(result.payload);
    if (result.failed) {
      return res.status(404).json({
        success: false,
        error: result.failed.error || 'Lien non trouvé ou inaccessible',
        id: result.failed.id || id,
        debug: result.failed.debug || ''
      });
    }
    if (result.queued) {
      return res.status(202).json({
        status: 'queued',
        queue_size: result.queue_size,
        id
      });
    }
    if (result.rateLimited) {
      return res.status(503).json({
        success: false,
        error: 'rate_limited',
        retry_at: result.retryAt
      });
    }
    if (result.unavailable) {
      return res.status(503).json({
        success: false,
        error: 'queue_unavailable',
        message: 'Infrastructure indisponible, réessaie plus tard'
      });
    }

    return res.status(500).json({ success: false, error: 'Unknown decode result' });

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Erreur lors du décodage du lien DarkiWorld',
        message: error.message
      });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /seasons/:titleId
// Récupérer les saisons d'une série depuis DarkiWorld
// Params: titleId (ID DarkiWorld de la série)
// Query: page (optionnel, défaut: 1), perPage (optionnel, défaut: 8)
// ---------------------------------------------------------------------------
router.get('/seasons/:titleId', async (req, res) => {
  let cacheKey;
  let dataReturned = false;
  try {
    const { titleId } = req.params;
    const { page = 1, perPage = 8, mode = 'auto' } = req.query;

    if (!titleId) {
      return res.status(400).json({
        success: false,
        error: 'ID de la série requis'
      });
    }

    const currentPage = parsePositiveInt(page, 1);
    const itemsPerPage = parsePositiveInt(perPage, 8);
    const normalizedMode = mode === 'legacy' ? 'legacy' : mode === 'seasonPage' ? 'seasonPage' : 'auto';

    // Nouvelle clÃ© de cache pour Ã©viter de ressortir l'ancien format paginÃ©.
    cacheKey = generateCacheKey(`darkiworld_seasons_v2_${normalizedMode}_${titleId}_${currentPage}_${itemsPerPage}`);

    // Check if results are in cache without expiration (stale-while-revalidate)
    const cachedData = await getFromCacheNoExpiration(DOWNLOAD_CACHE_DIR, cacheKey);

    if (cachedData) {
      // console.log(`Saisons pour ${titleId} récupérées du cache`);
      res.status(200).json(cachedData); // Return cached data immediately
      dataReturned = true;
    }

    // Récupérer les saisons depuis DarkiWorld
    let responseData = null;

    if (normalizedMode !== 'legacy') {
      responseData = await fetchSeasonsCountResponse(titleId, currentPage, itemsPerPage);
    }

    if (!responseData) {
      responseData = await fetchLegacySeasonsPage(titleId, currentPage, itemsPerPage);
    }

    // Si on n'a pas encore retourné de données, retourner maintenant
    if (!dataReturned) {
      res.json(responseData);
    }

    // Background update du cache
    (async () => {
      try {
        // Vérifier si le cache doit être mis à jour
        const shouldUpdate = await shouldUpdateCache(DOWNLOAD_CACHE_DIR, cacheKey);
        if (!shouldUpdate) {
          return; // Ne pas mettre à jour le cache
        }

        // Si on a des données, sauvegarder dans le cache
        if (responseData && responseData.pagination) {
          await saveToCache(DOWNLOAD_CACHE_DIR, cacheKey, responseData);
        }
      } catch (cacheError) {
        // Silent fail on cache save
      }
    })();

  } catch (error) {

    // Si Darkino retourne 500, ne pas créer/mettre à jour le cache et renvoyer le cache existant si présent
    if (error.response && error.response.status >= 500) {
      // Si on a déjà retourné des données (cache), on ne fait RIEN
      if (dataReturned) return;

      try {
        const fallbackCache = await getFromCacheNoExpiration(DOWNLOAD_CACHE_DIR, cacheKey);
        if (fallbackCache) {
          return res.status(200).json(fallbackCache);
        }
      } catch (_) { }
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des saisons DarkiWorld',
        message: error.message
      });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /episodes/:titleId/:seasonNumber
// Récupérer les épisodes d'une saison depuis DarkiWorld
// Params: titleId (ID DarkiWorld de la série), seasonNumber (numéro de la saison: 0, 1, 2, etc.)
// Query: page (optionnel, défaut: 1), perPage (optionnel, défaut: 30)
// ---------------------------------------------------------------------------
router.get('/episodes/:titleId/:seasonNumber', async (req, res) => {
  let dataReturned = false;
  try {
    const { titleId, seasonNumber } = req.params;
    const { page = 1, perPage = 30 } = req.query;

    if (!titleId || seasonNumber === undefined) {
      return res.status(400).json({
        success: false,
        error: 'ID de la série et numéro de saison requis'
      });
    }

    // Generate cache key
    const cacheKey = generateCacheKey(`darkiworld_episodes_${titleId}_${seasonNumber}_${page}_${perPage}`);

    // Check if results are in cache without expiration (stale-while-revalidate)
    const cachedData = await getFromCacheNoExpiration(DOWNLOAD_CACHE_DIR, cacheKey);

    if (cachedData) {
      // console.log(`Épisodes pour ${titleId}/${seasonNumber} récupérés du cache`);
      res.status(200).json(cachedData); // Return cached data immediately
      dataReturned = true;
    }

    // Récupérer les épisodes depuis DarkiWorld
    const episodesResponse = await axiosDarkinoRequest({
      method: 'get',
      url: `/api/v1/titles/${titleId}/seasons/${seasonNumber}/episodes?perPage=${perPage}&excludeDescription=true&query=&orderBy=episode_number&orderDir=asc&page=${page}`
    });

    const responseData = {
      success: true,
      ...episodesResponse.data
    };

    // Si on n'a pas encore retourné de données, retourner maintenant
    if (!dataReturned) {
      res.json(responseData);
    }

    // Background update du cache
    (async () => {
      try {
        // Vérifier si le cache doit être mis à jour
        const shouldUpdate = await shouldUpdateCache(DOWNLOAD_CACHE_DIR, cacheKey);
        if (!shouldUpdate) {
          return; // Ne pas mettre à jour le cache
        }

        // Si on a des données, sauvegarder dans le cache
        if (episodesResponse.data && episodesResponse.data.pagination) {
          await saveToCache(DOWNLOAD_CACHE_DIR, cacheKey, responseData);
        }
      } catch (cacheError) {
        // Silent fail on cache save
      }
    })();

  } catch (error) {

    // Si Darkino retourne 500, ne pas créer/mettre à jour le cache et renvoyer le cache existant si présent
    if (error.response && error.response.status >= 500) {
      // Si on a déjà retourné des données (cache), on ne fait RIEN
      if (dataReturned) return;

      try {
        const fallbackCache = await getFromCacheNoExpiration(DOWNLOAD_CACHE_DIR, cacheKey);
        if (fallbackCache) {
          return res.status(200).json(fallbackCache);
        }
      } catch (_) { }
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des épisodes DarkiWorld',
        message: error.message
      });
    }
  }
});

module.exports = router;
module.exports.configure = configure;
module.exports.findAllEntriesForEpisode = findAllEntriesForEpisode;
