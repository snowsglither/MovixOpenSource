/**
 * LKS TV — Historique & Watchlist par profil (sans auth JWT).
 *
 * Le profile_id est lu depuis le header x-profile-id OU le body.
 *
 * GET    /api/lkstv/history                      → 50 dernières entrées
 * POST   /api/lkstv/history                      → UPSERT
 * DELETE /api/lkstv/history/:mediaType/:mediaId  → supprime
 * GET    /api/lkstv/watchlist                     → watchlist complète
 * POST   /api/lkstv/watchlist                     → INSERT IGNORE
 * DELETE /api/lkstv/watchlist/:mediaType/:mediaId → supprime
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../mysqlPool');

function getProfileId(req) {
  return (req.headers['x-profile-id'] || (req.body && req.body.profile_id) || '').trim();
}

// ─── HISTORY ────────────────────────────────────────────────────────────────

// GET /api/lkstv/history
router.get('/history', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis (header x-profile-id ou body)' });
  }

  const pool = getPool();
  try {
    const [rows] = await pool.execute(
      `SELECT id, profile_id, media_type, media_id, title, poster_path,
              progress, duration, season, episode, watched_at
       FROM lkstv_history
       WHERE profile_id = ?
       ORDER BY watched_at DESC
       LIMIT 50`,
      [profileId]
    );
    return res.json({ history: rows });
  } catch (err) {
    console.error('[lkstvHistory] GET /history error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/lkstv/history
router.post('/history', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis' });
  }

  const {
    media_type, media_id, title, poster_path,
    progress, duration, season, episode
  } = req.body || {};

  if (!media_type || !['movie', 'tv', 'anime'].includes(media_type)) {
    return res.status(400).json({ error: 'media_type doit être "movie", "tv" ou "anime"' });
  }
  if (!media_id) {
    return res.status(400).json({ error: 'media_id requis' });
  }

  const pool = getPool();
  try {
    await pool.execute(
      `INSERT INTO lkstv_history
         (profile_id, media_type, media_id, title, poster_path, progress, duration, season, episode, watched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         title        = VALUES(title),
         poster_path  = VALUES(poster_path),
         progress     = VALUES(progress),
         duration     = VALUES(duration),
         season       = VALUES(season),
         episode      = VALUES(episode),
         watched_at   = CURRENT_TIMESTAMP`,
      [
        profileId,
        media_type,
        Number(media_id),
        title || null,
        poster_path || null,
        progress != null ? Number(progress) : 0,
        duration != null ? Number(duration) : 0,
        season != null ? Number(season) : null,
        episode != null ? Number(episode) : null,
      ]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvHistory] POST /history error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/lkstv/history/:mediaType/:mediaId
router.delete('/history/:mediaType/:mediaId', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis (header x-profile-id)' });
  }

  const { mediaType, mediaId } = req.params;
  if (!['movie', 'tv', 'anime'].includes(mediaType)) {
    return res.status(400).json({ error: 'mediaType doit être "movie", "tv" ou "anime"' });
  }

  const pool = getPool();
  try {
    await pool.execute(
      'DELETE FROM lkstv_history WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      [profileId, mediaType, Number(mediaId)]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvHistory] DELETE /history error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/lkstv/history — vider tout l'historique d'un profil
router.delete('/history', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis (header x-profile-id)' });
  }
  const pool = getPool();
  try {
    await pool.execute('DELETE FROM lkstv_history WHERE profile_id = ?', [profileId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvHistory] DELETE /history (all) error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── WATCHLIST ───────────────────────────────────────────────────────────────

// GET /api/lkstv/watchlist
router.get('/watchlist', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis (header x-profile-id ou body)' });
  }

  const pool = getPool();
  try {
    const [rows] = await pool.execute(
      `SELECT id, profile_id, media_type, media_id, title, poster_path, added_at
       FROM lkstv_watchlist
       WHERE profile_id = ?
       ORDER BY added_at DESC`,
      [profileId]
    );
    return res.json({ watchlist: rows });
  } catch (err) {
    console.error('[lkstvHistory] GET /watchlist error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/lkstv/watchlist
router.post('/watchlist', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis' });
  }

  const { media_type, media_id, title, poster_path } = req.body || {};

  if (!media_type || !['movie', 'tv', 'anime'].includes(media_type)) {
    return res.status(400).json({ error: 'media_type doit être "movie", "tv" ou "anime"' });
  }
  if (!media_id) {
    return res.status(400).json({ error: 'media_id requis' });
  }

  const pool = getPool();
  try {
    await pool.execute(
      `INSERT IGNORE INTO lkstv_watchlist (profile_id, media_type, media_id, title, poster_path)
       VALUES (?, ?, ?, ?, ?)`,
      [
        profileId,
        media_type,
        Number(media_id),
        title || null,
        poster_path || null,
      ]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvHistory] POST /watchlist error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/lkstv/watchlist/:mediaType/:mediaId
router.delete('/watchlist/:mediaType/:mediaId', async (req, res) => {
  const profileId = getProfileId(req);
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id requis (header x-profile-id)' });
  }

  const { mediaType, mediaId } = req.params;
  if (!['movie', 'tv', 'anime'].includes(mediaType)) {
    return res.status(400).json({ error: 'mediaType doit être "movie", "tv" ou "anime"' });
  }

  const pool = getPool();
  try {
    await pool.execute(
      'DELETE FROM lkstv_watchlist WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      [profileId, mediaType, Number(mediaId)]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvHistory] DELETE /watchlist error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
