/**
 * Admin routes.
 * Extracted from server.js -- streaming links CRUD, VIP key management, admin checks, anime cache.
 * Mount point: app.use('/api', router)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fsp = require('fs').promises;
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const axios = require('axios');
const { isAdmin, isUploaderOrAdmin } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const { verifyAccessKey, invalidateVipCache } = require('../checkVip');
const { ANIME_SAMA_CACHE_DIR } = require('../utils/cacheManager');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { logDownloadLinkAction } = require('../utils/downloadLinksHistory');

function parseAccessKeyExpiresAt(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const normalizedValue = String(value).trim();
  if (!normalizedValue) {
    return null;
  }

  if (/^\d+$/.test(normalizedValue)) {
    return Number(normalizedValue);
  }

  const parsed = new Date(
    normalizedValue.includes('T')
      ? normalizedValue
      : normalizedValue.replace(' ', 'T')
  );
  const timestamp = parsed.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error('Date d\'expiration invalide');
  }

  return timestamp;
}

function buildAccessKeyExpiryFromDuration(durationLabel) {
  if (!durationLabel) {
    return null;
  }

  const now = new Date();
  const match = durationLabel.match(/(\d+)\s*(min|minute|minutes|h|hour|hours|heure|heures|d|day|days|jour|jours|m|month|months|mois|y|year|years|an|ans)/i);

  if (!match) {
    return null;
  }

  const duration = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit.startsWith('min')) {
    now.setMinutes(now.getMinutes() + duration);
  } else if (unit.startsWith('h')) {
    now.setHours(now.getHours() + duration);
  } else if (unit.startsWith('d') || unit.startsWith('j')) {
    now.setDate(now.getDate() + duration);
  } else if (unit.startsWith('m')) {
    now.setMonth(now.getMonth() + duration);
  } else if (unit.startsWith('y') || unit.startsWith('an')) {
    now.setFullYear(now.getFullYear() + duration);
  }

  return now.getTime();
}

// Rate limiter pour la vérification de codes VIP
// 5 tentatives par IP toutes les 15 minutes (plus strict car code bruteforceable)
const vipCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:admin:vip-code-check:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de tentatives de vérification. Réessayez dans 15 minutes.'
  },
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || ipKeyGenerator(req.ip),
  validate: { xForwardedForHeader: false, ip: false }
});

// === PUBLIC ROUTES (no authentication) ===

/**
 * GET /frembed/check/:type/:id
 * Proxy the frembed availability check to avoid browser CORS restrictions.
 * type: movie | tv   id: TMDB ID
 * Query (TV only): sa=<season>&epi=<episode>
 */
router.get('/frembed/check/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const { sa, epi } = req.query;

  let frembedUrl;
  if (type === 'tv') {
    frembedUrl = `https://frembed.click/api/public/v1/tv/${id}?sa=${sa || 1}&epi=${epi || 1}`;
  } else {
    frembedUrl = `https://frembed.click/api/public/v1/movies/${id}`;
  }

  try {
    const response = await axios.get(frembedUrl, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://frembed.click/',
      }
    });
    res.json(response.data);
  } catch (error) {
    // Si frembed est injoignable ou refuse → renvoyer un objet neutre (pas indisponible)
    res.status(200).json({ status: 0, result: { totalItems: 0 } });
  }
});

/**
 * GET /links/:type/:id
 * Retrieve streaming links for a movie or series
 * Params: type (movie/tv), id (TMDB ID)
 * Query: season (optional for series), episode (optional for series)
 */
router.get('/links/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { season, episode } = req.query;

    // Validation
    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type invalide. Utilisez "movie" ou "tv"' });
    }

    let pool;
    try {
      pool = getPool();
    } catch (_poolErr) {
      return res.status(404).json({ success: false, error: 'Aucun lien trouvé', type, id });
    }
    let query, params;

    if (type === 'movie') {
      query = 'SELECT id, links FROM films WHERE id = ?';
      params = [id];
    } else {
      // Pour les séries
      if (!season || !episode) {
        // Retourner tous les épisodes de la série
        query = 'SELECT id, series_id, season_number, episode_number, links FROM series WHERE series_id = ? ORDER BY season_number, episode_number';
        params = [id];
      } else {
        // Retourner un épisode spécifique
        query = 'SELECT id, series_id, season_number, episode_number, links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?';
        params = [id, parseInt(season), parseInt(episode)];
      }
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Aucun lien trouvé',
        type,
        id,
        ...(season && { season }),
        ...(episode && { episode })
      });
    }

    // Parser les liens JSON
    const result = rows.map(row => ({
      ...row,
      links: typeof row.links === 'string' ? JSON.parse(row.links) : row.links
    }));

    res.json({
      success: true,
      type,
      data: type === 'movie' ? result[0] : result
    });

  } catch (error) {
    // Table inexistante ou MySQL indisponible → pas de liens, pas de crash
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ECONNREFUSED' || error.code === 'ER_ACCESS_DENIED_ERROR') {
      const { type, id } = req.params;
      return res.status(404).json({ success: false, error: 'Aucun lien trouvé', type, id });
    }
    console.error('Error fetching streaming links:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des liens',
      message: error.message
    });
  }
});

/**
 * POST /verify-access-code
 * Verify a VIP access code (used during initial code entry)
 * Body: { code: string }
 */
router.post('/verify-access-code', vipCodeRateLimit, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Code d\'accès requis'
      });
    }

    // Utiliser le module centralisé checkVip
    const vipStatus = await verifyAccessKey(code);

    if (!vipStatus.vip) {
      if (vipStatus.reason === 'key_expired') {
        return res.status(410).json({
          success: false,
          error: 'Code d\'accès expiré'
        });
      }
      if (vipStatus.reason === 'key_inactive') {
        return res.status(403).json({
          success: false,
          error: 'Code d\'accès désactivé'
        });
      }
      return res.status(404).json({
        success: false,
        error: 'Code d\'accès invalide ou expiré'
      });
    }

    return res.json({
      success: true,
      message: 'Code d\'accès valide',
      data: {
        key: code,
        duration: vipStatus.duration,
        expiresAt: vipStatus.expiresAt
      }
    });

  } catch (error) {
    console.error('Error verifying access code:', error);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification du code d\'accès'
    });
  }
});

/**
 * GET /check-vip
 * Server-side VIP status check via x-access-key header.
 * Called periodically by the frontend to ensure the key is still valid.
 * If the key is no longer valid, the frontend must revoke the local VIP status.
 */
router.get('/check-vip', async (req, res) => {
  try {
    const accessKey = req.headers['x-access-key'];

    if (!accessKey) {
      return res.json({ vip: false, reason: 'no_key' });
    }

    const vipStatus = await verifyAccessKey(accessKey);

    return res.json({
      vip: vipStatus.vip,
      expiresAt: vipStatus.expiresAt || null,
      duration: vipStatus.duration || null,
      reason: vipStatus.reason || null
    });

  } catch (error) {
    console.error('Error checking VIP status:', error);
    return res.status(500).json({ vip: false, error: 'Erreur interne' });
  }
});

// === ADMIN ROUTES (with authentication) ===

/**
 * POST /admin/links
 * Add or update streaming links
 * Body: { type: 'movie'|'tv', id: string, links: array, season?: number, episode?: number }
 */
router.post('/admin/links', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id, links, season, episode } = req.body;

    // Validation
    if (!type || !id || !links || !Array.isArray(links)) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres invalides. Required: type, id, links (array)'
      });
    }

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type invalide. Utilisez "movie" ou "tv"' });
    }

    if (type === 'tv' && (season === undefined || season === null || episode === undefined || episode === null)) {
      return res.status(400).json({
        success: false,
        error: 'Pour les séries, season et episode sont requis'
      });
    }

    const pool = getPool();

    if (type === 'movie') {
      // Récupérer les liens existants
      const [existing] = await pool.execute(
        'SELECT links FROM films WHERE id = ?',
        [id]
      );

      let finalLinks = links;
      let movieUrlsToLog = links.map(l => typeof l === 'string' ? l : l.url || JSON.stringify(l));
      if (existing.length > 0 && existing[0].links) {
        // Parse existing links
        const existingLinks = typeof existing[0].links === 'string'
          ? JSON.parse(existing[0].links)
          : existing[0].links;

        // Merge with new links, avoiding duplicates
        const existingUrls = new Set(existingLinks.map(link =>
          typeof link === 'string' ? link : link.url || JSON.stringify(link)
        ));

        const newLinksToAdd = links.filter(link => {
          const url = typeof link === 'string' ? link : link.url || JSON.stringify(link);
          return !existingUrls.has(url);
        });

        finalLinks = [...existingLinks, ...newLinksToAdd];
        movieUrlsToLog = newLinksToAdd.map(l => typeof l === 'string' ? l : l.url || JSON.stringify(l));
      }

      // Log each new streaming link as 'added' in history (for leaderboard scoring)
      for (const url of movieUrlsToLog) {
        try {
          await logDownloadLinkAction({
            adminId: req.admin.userId,
            userType: req.admin.userType,
            action: 'added',
            mediaType: 'movie',
            tmdbId: id,
            season: null,
            episode: null,
            linkUrl: url,
            linkType: 'streaming',
          });
        } catch (e) {
          console.error('Failed to log streaming link add:', e);
        }
      }

      const linksJson = JSON.stringify(finalLinks);

      // Insérer ou mettre à jour le film
      await pool.execute(
        'INSERT INTO films (id, links) VALUES (?, ?) ON DUPLICATE KEY UPDATE links = VALUES(links), updated_at = CURRENT_TIMESTAMP',
        [id, linksJson]
      );

      res.json({
        success: true,
        message: 'Liens de film ajoutés/mis à jour avec succès',
        type: 'movie',
        id,
        linksCount: finalLinks.length
      });

    } else {
      // Insérer ou mettre à jour l'épisode de série
      // Vérifier si l'épisode existe déjà
      const [existing] = await pool.execute(
        'SELECT id, links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [id, season, episode]
      );

      let finalLinks = links;
      let streamingUrlsToLog = links.map(l => typeof l === 'string' ? l : l.url || JSON.stringify(l));
      if (existing.length > 0 && existing[0].links) {
        // Parse existing links
        const existingLinks = typeof existing[0].links === 'string'
          ? JSON.parse(existing[0].links)
          : existing[0].links;

        // Merge with new links, avoiding duplicates
        const existingUrls = new Set(existingLinks.map(link =>
          typeof link === 'string' ? link : link.url || JSON.stringify(link)
        ));

        const newLinksToAdd = links.filter(link => {
          const url = typeof link === 'string' ? link : link.url || JSON.stringify(link);
          return !existingUrls.has(url);
        });

        finalLinks = [...existingLinks, ...newLinksToAdd];
        streamingUrlsToLog = newLinksToAdd.map(l => typeof l === 'string' ? l : l.url || JSON.stringify(l));
      }

      // Log each new streaming link as 'added' in history (for leaderboard scoring)
      for (const url of streamingUrlsToLog) {
        try {
          await logDownloadLinkAction({
            adminId: req.admin.userId,
            userType: req.admin.userType,
            action: 'added',
            mediaType: 'tv',
            tmdbId: id,
            season: Number(season),
            episode: Number(episode),
            linkUrl: url,
            linkType: 'streaming',
          });
        } catch (e) {
          console.error('Failed to log streaming link add:', e);
        }
      }

      const linksJson = JSON.stringify(finalLinks);

      if (existing.length > 0) {
        // Mise à jour
        await pool.execute(
          'UPDATE series SET links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?',
          [linksJson, id, season, episode]
        );
      } else {
        // Insertion
        await pool.execute(
          'INSERT INTO series (series_id, season_number, episode_number, links) VALUES (?, ?, ?, ?)',
          [id, season, episode, linksJson]
        );
      }

      res.json({
        success: true,
        message: 'Liens d\'épisode ajoutés/mis à jour avec succès',
        type: 'tv',
        id,
        season,
        episode,
        linksCount: finalLinks.length
      });
    }

  } catch (error) {
    console.error('Error adding streaming links:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'ajout des liens',
      message: error.message
    });
  }
});

/**
 * DELETE /admin/links
 * Delete streaming links
 * Body: { type: 'movie'|'tv', id: string, season?: number, episode?: number }
 */
router.delete('/admin/links', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id, season, episode } = req.body;

    // Validation
    if (!type || !id) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres invalides. Required: type, id'
      });
    }

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type invalide. Utilisez "movie" ou "tv"' });
    }

    const pool = getPool();

    if (type === 'movie') {
      // Fetch existing links for history logging before deletion
      const [existingFilmRows] = await pool.execute('SELECT links FROM films WHERE id = ?', [id]);
      if (existingFilmRows.length > 0 && existingFilmRows[0].links) {
        const existingLinks = typeof existingFilmRows[0].links === 'string'
          ? JSON.parse(existingFilmRows[0].links)
          : existingFilmRows[0].links;
        for (const link of (existingLinks || [])) {
          const url = typeof link === 'string' ? link : link.url || JSON.stringify(link);
          try {
            await logDownloadLinkAction({
              adminId: req.admin.userId,
              userType: req.admin.userType,
              action: 'removed',
              mediaType: 'movie',
              tmdbId: id,
              season: null,
              episode: null,
              linkUrl: url,
              linkType: 'streaming',
            });
          } catch (e) {
            console.error('Failed to log streaming link removal:', e);
          }
        }
      }

      const [result] = await pool.execute('DELETE FROM films WHERE id = ?', [id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Film non trouvé' });
      }

      res.json({
        success: true,
        message: 'Film supprimé avec succès',
        type: 'movie',
        id
      });

    } else {
      // Pour les séries
      // Fetch existing links for history logging before deletion
      let fetchQuery, fetchParams;
      if (season && episode) {
        fetchQuery = 'SELECT links, season_number, episode_number FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?';
        fetchParams = [id, season, episode];
      } else if (season) {
        fetchQuery = 'SELECT links, season_number, episode_number FROM series WHERE series_id = ? AND season_number = ?';
        fetchParams = [id, season];
      } else {
        fetchQuery = 'SELECT links, season_number, episode_number FROM series WHERE series_id = ?';
        fetchParams = [id];
      }
      const [existingSeriesRows] = await pool.execute(fetchQuery, fetchParams);
      for (const row of existingSeriesRows) {
        if (!row.links) continue;
        const existingLinks = typeof row.links === 'string' ? JSON.parse(row.links) : row.links;
        for (const link of (existingLinks || [])) {
          const url = typeof link === 'string' ? link : link.url || JSON.stringify(link);
          try {
            await logDownloadLinkAction({
              adminId: req.admin.userId,
              userType: req.admin.userType,
              action: 'removed',
              mediaType: 'tv',
              tmdbId: id,
              season: row.season_number,
              episode: row.episode_number,
              linkUrl: url,
              linkType: 'streaming',
            });
          } catch (e) {
            console.error('Failed to log streaming link removal:', e);
          }
        }
      }

      let query, params;

      if (season && episode) {
        // Supprimer un épisode spécifique
        query = 'DELETE FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?';
        params = [id, season, episode];
      } else if (season) {
        // Supprimer toute une saison
        query = 'DELETE FROM series WHERE series_id = ? AND season_number = ?';
        params = [id, season];
      } else {
        // Supprimer toute la série
        query = 'DELETE FROM series WHERE series_id = ?';
        params = [id];
      }

      const [result] = await pool.execute(query, params);

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Aucune donnée trouvée à supprimer' });
      }

      res.json({
        success: true,
        message: `${result.affectedRows} épisode(s) supprimé(s) avec succès`,
        type: 'tv',
        id,
        ...(season && { season }),
        ...(episode && { episode }),
        deletedCount: result.affectedRows
      });
    }

  } catch (error) {
    console.error('Error deleting streaming links:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression des liens',
      message: error.message
    });
  }
});

/**
 * PUT /admin/links
 * Modify streaming links (complete replacement)
 * Body: { type: 'movie'|'tv', id: string, links: array, season?: number, episode?: number }
 */
router.put('/admin/links', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id, links, season, episode } = req.body;

    // Validation
    if (!type || !id || !links || !Array.isArray(links)) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres invalides. Required: type, id, links (array)'
      });
    }

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type invalide. Utilisez "movie" ou "tv"' });
    }

    if (type === 'tv' && (season === undefined || season === null || episode === undefined || episode === null)) {
      return res.status(400).json({
        success: false,
        error: 'Pour les séries, season et episode sont requis'
      });
    }

    const pool = getPool();
    const linksJson = JSON.stringify(links);

    if (type === 'movie') {
      const [result] = await pool.execute(
        'UPDATE films SET links = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [linksJson, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Film non trouvé' });
      }

      res.json({
        success: true,
        message: 'Liens de film modifiés avec succès',
        type: 'movie',
        id,
        linksCount: links.length
      });

    } else {
      const [result] = await pool.execute(
        'UPDATE series SET links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [linksJson, id, season, episode]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: 'Épisode non trouvé' });
      }

      res.json({
        success: true,
        message: 'Liens d\'épisode modifiés avec succès',
        type: 'tv',
        id,
        season,
        episode,
        linksCount: links.length
      });
    }

  } catch (error) {
    console.error('Error updating streaming links:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification des liens',
      message: error.message
    });
  }
});

// === ADMIN ROUTES - VIP KEY MANAGEMENT ===

/**
 * GET /admin/check
 * Verify admin rights (admin or uploader)
 */
router.get('/admin/check', isUploaderOrAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Droits d\'administration confirmés',
      admin: {
        userId: req.admin.userId,
        userType: req.admin.userType,
        adminId: req.admin.adminId,
        role: req.admin.role // Inclure le rôle dans la réponse
      }
    });
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la vérification admin' });
  }
});

/**
 * GET /admin/vip-keys
 * Retrieve all VIP keys
 * Query: active (optional, true/false), used (optional, true/false), search, page, limit
 */
router.get('/admin/vip-keys', isAdmin, async (req, res) => {
  try {
    const { active, used } = req.query;
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (active !== undefined) {
      conditions.push('active = ?');
      params.push(active === 'true' ? 1 : 0);
    }

    if (used !== undefined) {
      conditions.push('used = ?');
      params.push(used === 'true' ? 1 : 0);
    }

    if (search) {
      const likeSearch = `%${search}%`;
      conditions.push(`(
        key_value LIKE ?
        OR COALESCE(duree_validite, '') LIKE ?
        OR COALESCE(CAST(expires_at AS CHAR), '') LIKE ?
        OR COALESCE(DATE_FORMAT(FROM_UNIXTIME(expires_at / 1000), '%Y-%m-%d %H:%i:%s'), '') LIKE ?
        OR COALESCE(DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s'), '') LIKE ?
      )`);
      params.push(likeSearch, likeSearch, likeSearch, likeSearch, likeSearch);
    }

    let whereClause = '';
    if (conditions.length > 0) {
      whereClause = ` WHERE ${conditions.join(' AND ')}`;
    }

    const pool = getPool();
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM access_keys${whereClause}`,
      params
    );
    const total = Number(countRow?.total || 0);

    const [rows] = await pool.execute(
      `SELECT * FROM access_keys${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      keys: rows,
      count: rows.length,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total
    });

  } catch (error) {
    console.error('Error fetching VIP keys:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des clés VIP',
      message: error.message
    });
  }
});

/**
 * POST /admin/vip-keys
 * Add a new VIP key
 * Body: { key: string, duree_validite?: string, expires_at?: string }
 */
router.post('/admin/vip-keys', isAdmin, async (req, res) => {
  try {
    const { key, duree_validite, expires_at } = req.body;

    // Validation
    if (!key || key.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'La clé est requise et ne peut pas être vide'
      });
    }

    if (key.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'La clé ne peut pas dépasser 255 caractères'
      });
    }

    const pool = getPool();

    // Vérifier si la clé existe déjà
    const [existing] = await pool.execute(
      'SELECT key_value FROM access_keys WHERE key_value = ?',
      [key]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Cette clé existe déjà'
      });
    }

    // Calculer la date d'expiration si duree_validite est fournie
    let expiresAtValue = parseAccessKeyExpiresAt(expires_at);

    if (duree_validite && !expires_at) {
      expiresAtValue = buildAccessKeyExpiryFromDuration(duree_validite);
    }

    // Insérer la nouvelle clé
    await pool.execute(
      'INSERT INTO access_keys (key_value, active, used, duree_validite, expires_at, created_at) VALUES (?, 1, 0, ?, ?, NOW())',
      [key, duree_validite || null, expiresAtValue || null]
    );

    // Invalider le cache VIP pour cette clé
    invalidateVipCache(key);

    res.status(201).json({
      success: true,
      message: 'Clé VIP créée avec succès',
      key: {
        key_value: key,
        duree_validite: duree_validite || null,
        expires_at: expiresAtValue || null,
        active: true,
        used: false
      }
    });

  } catch (error) {
    console.error('Error adding VIP key:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'ajout de la clé VIP',
      message: error.message
    });
  }
});

/**
 * PUT /admin/vip-keys/:key
 * Modify a VIP key (expiration, duration, status)
 * Body: { duree_validite?: string, expires_at?: string, active?: boolean, used?: boolean }
 */
router.put('/admin/vip-keys/:key', isAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { duree_validite, expires_at, active, used } = req.body;

    const pool = getPool();

    // Vérifier si la clé existe
    const [existing] = await pool.execute(
      'SELECT * FROM access_keys WHERE key_value = ?',
      [key]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Clé VIP non trouvée'
      });
    }

    // Construire la requête de mise à jour dynamiquement
    const updates = [];
    const params = [];

    if (duree_validite !== undefined) {
      updates.push('duree_validite = ?');
      params.push(duree_validite || null);

      // Si duree_validite est fournie, calculer la nouvelle date d'expiration
      if (duree_validite && expires_at === undefined) {
        const computedExpiresAt = buildAccessKeyExpiryFromDuration(duree_validite);
        if (computedExpiresAt !== null) {
          updates.push('expires_at = ?');
          params.push(computedExpiresAt);
        }
      }
    }

    if (expires_at !== undefined) {
      updates.push('expires_at = ?');
      params.push(parseAccessKeyExpiresAt(expires_at));
    }

    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }

    if (used !== undefined) {
      updates.push('used = ?');
      params.push(used ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Aucune modification fournie'
      });
    }

    params.push(key);

    await pool.execute(
      `UPDATE access_keys SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE key_value = ?`,
      params
    );

    // Invalider le cache VIP pour cette clé
    invalidateVipCache(key);

    // Récupérer la clé mise à jour
    const [updated] = await pool.execute(
      'SELECT * FROM access_keys WHERE key_value = ?',
      [key]
    );

    res.json({
      success: true,
      message: 'Clé VIP modifiée avec succès',
      key: updated[0]
    });

  } catch (error) {
    console.error('Error updating VIP key:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification de la clé VIP',
      message: error.message
    });
  }
});

/**
 * DELETE /admin/vip-keys/:key
 * Delete a VIP key
 */
router.delete('/admin/vip-keys/:key', isAdmin, async (req, res) => {
  try {
    const { key } = req.params;

    const pool = getPool();
    const [result] = await pool.execute(
      'DELETE FROM access_keys WHERE key_value = ?',
      [key]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Clé VIP non trouvée'
      });
    }

    // Invalider le cache VIP pour cette clé
    invalidateVipCache(key);

    res.json({
      success: true,
      message: 'Clé VIP supprimée avec succès',
      key
    });

  } catch (error) {
    console.error('Error deleting VIP key:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression de la clé VIP',
      message: error.message
    });
  }
});

function mergeDownloadLinks(existing, incoming, { adminId, userType, fullSeason }) {
  const existingLinks = Array.isArray(existing) ? existing : [];
  const existingUrls = new Set(existingLinks.map(l => l.url));
  const toAdd = [];
  for (const link of incoming) {
    if (!link || typeof link !== 'object' || !link.url) continue;
    if (existingUrls.has(link.url)) continue;
    const entry = {
      url: String(link.url),
      language: String(link.language || ''),
      quality: String(link.quality || ''),
      sub: Boolean(link.sub),
      host: String(link.host || ''),
      size: link.size ? String(link.size) : '',
      added_at: new Date().toISOString(),
      added_by: { id: String(adminId), auth_type: userType === 'bip39' ? 'bip-39' : 'oauth' },
    };
    if (fullSeason) entry.full_saison = true;
    toAdd.push(entry);
    existingUrls.add(link.url);
  }
  return { merged: [...existingLinks, ...toAdd], added: toAdd };
}

router.post('/admin/download-links', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id, links, season, episode, fullSeason } = req.body;

    if (!type || !id || !Array.isArray(links)) {
      return res.status(400).json({ success: false, error: 'Required: type, id, links[]' });
    }
    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be movie or tv' });
    }
    if (type === 'movie' && fullSeason) {
      return res.status(400).json({ success: false, error: 'fullSeason is only valid for tv' });
    }
    if (type === 'tv') {
      if (season == null) {
        return res.status(400).json({ success: false, error: 'season is required for tv' });
      }
      if (!fullSeason && episode == null) {
        return res.status(400).json({ success: false, error: 'episode is required for tv (or set fullSeason=true)' });
      }
    }
    for (const l of links) {
      if (!l || !l.url || !l.language || !l.quality || !l.host) {
        return res.status(400).json({ success: false, error: 'Each link must have url, language, quality, host' });
      }
    }

    const pool = getPool();
    const adminId = req.admin.userId;
    const userType = req.admin.userType;
    const episodeForStorage = type === 'tv' ? (fullSeason ? 0 : Number(episode)) : null;

    let existing;
    if (type === 'movie') {
      const [rows] = await pool.execute('SELECT download_links FROM films WHERE id = ?', [id]);
      existing = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
    } else {
      const [rows] = await pool.execute(
        'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [id, season, episodeForStorage]
      );
      existing = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
    }

    const { merged, added } = mergeDownloadLinks(existing, links, { adminId, userType, fullSeason: Boolean(fullSeason) });
    const mergedJson = JSON.stringify(merged);

    if (type === 'movie') {
      await pool.execute(
        'INSERT INTO films (id, download_links) VALUES (?, ?) ON DUPLICATE KEY UPDATE download_links = VALUES(download_links), updated_at = CURRENT_TIMESTAMP',
        [id, mergedJson]
      );
    } else {
      const [rows] = await pool.execute(
        'SELECT id FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [id, season, episodeForStorage]
      );
      if (rows.length > 0) {
        await pool.execute(
          'UPDATE series SET download_links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?',
          [mergedJson, id, season, episodeForStorage]
        );
      } else {
        await pool.execute(
          'INSERT INTO series (series_id, season_number, episode_number, download_links) VALUES (?, ?, ?, ?)',
          [id, season, episodeForStorage, mergedJson]
        );
      }
    }

    for (const link of added) {
      await logDownloadLinkAction({
        adminId,
        userType,
        action: 'added',
        mediaType: type,
        tmdbId: id,
        season: type === 'tv' ? season : null,
        episode: type === 'tv' ? episodeForStorage : null,
        linkUrl: link.url,
      });
    }

    res.json({ success: true, addedCount: added.length, totalCount: merged.length });
  } catch (error) {
    console.error('Error adding download links:', error);
    res.status(500).json({ success: false, error: 'Failed to add download links', message: error.message });
  }
});

router.delete('/admin/download-links', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id, season, episode, url, fullSeason } = req.body;
    if (!type || !id || !url) {
      return res.status(400).json({ success: false, error: 'Required: type, id, url' });
    }
    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be movie or tv' });
    }
    if (type === 'movie' && fullSeason) {
      return res.status(400).json({ success: false, error: 'fullSeason is only valid for tv' });
    }
    if (type === 'tv') {
      if (season == null) {
        return res.status(400).json({ success: false, error: 'season is required for tv' });
      }
      if (!fullSeason && episode == null) {
        return res.status(400).json({ success: false, error: 'episode is required for tv (or set fullSeason=true)' });
      }
    }

    const pool = getPool();
    const episodeForStorage = type === 'tv' ? (fullSeason ? 0 : Number(episode)) : null;
    let existing;
    if (type === 'movie') {
      const [rows] = await pool.execute('SELECT download_links FROM films WHERE id = ?', [id]);
      existing = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
    } else {
      const [rows] = await pool.execute(
        'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [id, season, episodeForStorage]
      );
      existing = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
    }

    const before = existing.length;
    const remaining = existing.filter(l => l.url !== url);
    if (remaining.length === before) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }

    const remainingJson = JSON.stringify(remaining);
    if (type === 'movie') {
      await pool.execute('UPDATE films SET download_links = ? WHERE id = ?', [remainingJson, id]);
    } else {
      await pool.execute(
        'UPDATE series SET download_links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [remainingJson, id, season, episodeForStorage]
      );
    }

    await logDownloadLinkAction({
      adminId: req.admin.userId,
      userType: req.admin.userType,
      action: 'removed',
      mediaType: type,
      tmdbId: id,
      season: type === 'tv' ? season : null,
      episode: type === 'tv' ? episodeForStorage : null,
      linkUrl: url,
    });

    res.json({ success: true, removedCount: 1, totalCount: remaining.length });
  } catch (error) {
    console.error('Error deleting download link:', error);
    res.status(500).json({ success: false, error: 'Failed to delete download link' });
  }
});

router.put('/admin/download-links', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id, season, episode, oldUrl, newLink, fullSeason } = req.body;
    if (!type || !id || !oldUrl || !newLink || !newLink.url) {
      return res.status(400).json({ success: false, error: 'Required: type, id, oldUrl, newLink.url' });
    }
    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be movie or tv' });
    }
    if (type === 'movie' && fullSeason) {
      return res.status(400).json({ success: false, error: 'fullSeason is only valid for tv' });
    }
    if (type === 'tv') {
      if (season == null) {
        return res.status(400).json({ success: false, error: 'season is required for tv' });
      }
      if (!fullSeason && episode == null) {
        return res.status(400).json({ success: false, error: 'episode is required for tv (or set fullSeason=true)' });
      }
    }

    const pool = getPool();
    const episodeForStorage = type === 'tv' ? (fullSeason ? 0 : Number(episode)) : null;
    let existing;
    if (type === 'movie') {
      const [rows] = await pool.execute('SELECT download_links FROM films WHERE id = ?', [id]);
      existing = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
    } else {
      const [rows] = await pool.execute(
        'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [id, season, episodeForStorage]
      );
      existing = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
    }

    const idx = existing.findIndex(l => l.url === oldUrl);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }
    const original = existing[idx];
    existing[idx] = {
      ...original,
      url: String(newLink.url),
      language: newLink.language != null ? String(newLink.language) : original.language,
      quality: newLink.quality != null ? String(newLink.quality) : original.quality,
      sub: newLink.sub != null ? Boolean(newLink.sub) : original.sub,
      host: newLink.host != null ? String(newLink.host) : original.host,
      size: newLink.size != null ? String(newLink.size) : original.size,
    };

    const updatedJson = JSON.stringify(existing);
    if (type === 'movie') {
      await pool.execute('UPDATE films SET download_links = ? WHERE id = ?', [updatedJson, id]);
    } else {
      await pool.execute(
        'UPDATE series SET download_links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [updatedJson, id, season, episodeForStorage]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating download link:', error);
    res.status(500).json({ success: false, error: 'Failed to update download link' });
  }
});

router.get('/admin/download-links/:type/:id', isUploaderOrAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { season, episode, fullSeason } = req.query;

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be movie or tv' });
    }

    const pool = getPool();
    if (type === 'movie') {
      const [rows] = await pool.execute('SELECT download_links FROM films WHERE id = ?', [id]);
      const links = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
      return res.json({ success: true, links });
    }

    if (season == null) {
      return res.status(400).json({ success: false, error: 'season is required for tv' });
    }

    const isFullSeasonQuery = fullSeason === 'true' || fullSeason === true;

    if (isFullSeasonQuery) {
      const [rows] = await pool.execute(
        'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = 0',
        [id, Number(season)]
      );
      const links = rows[0]?.download_links
        ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
        : [];
      return res.json({ success: true, links });
    }

    if (episode == null) {
      return res.status(400).json({ success: false, error: 'episode is required for tv (or set fullSeason=true)' });
    }

    const [episodeRows] = await pool.execute(
      'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
      [id, Number(season), Number(episode)]
    );
    const [seasonRows] = await pool.execute(
      'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = 0',
      [id, Number(season)]
    );

    const parse = (rows) => rows[0]?.download_links
      ? (typeof rows[0].download_links === 'string' ? JSON.parse(rows[0].download_links) : rows[0].download_links)
      : [];

    const links = [...parse(episodeRows), ...parse(seasonRows)];
    res.json({ success: true, links });
  } catch (error) {
    console.error('Error fetching download links:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch download links' });
  }
});

module.exports = router;
