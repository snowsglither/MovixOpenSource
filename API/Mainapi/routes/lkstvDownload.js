/**
 * LKS TV — public download-links endpoint.
 * Reads the download_links JSON column from the DB without any auth.
 *
 * GET /api/lkstv/download-links/movie/:tmdbId
 * GET /api/lkstv/download-links/tv/:tmdbId?season=1&episode=1
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../mysqlPool');

router.get('/download-links/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const season = parseInt(req.query.season, 10) || null;
  const episode = parseInt(req.query.episode, 10) || null;
  const pool = getPool();

  try {
    let rows;
    if (type === 'movie') {
      [rows] = await pool.execute(
        'SELECT download_links FROM films WHERE id = ?',
        [id]
      );
    } else if (type === 'tv') {
      if (!season || !episode) {
        return res.status(400).json({ error: 'season et episode requis pour les séries' });
      }
      [rows] = await pool.execute(
        'SELECT download_links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
        [id, season, episode]
      );
    } else {
      return res.status(400).json({ error: 'type invalide (movie ou tv)' });
    }

    if (!rows.length || !rows[0].download_links) {
      return res.json({ links: [] });
    }

    const raw = rows[0].download_links;
    const links = typeof raw === 'string' ? JSON.parse(raw) : raw;
    res.json({ links: Array.isArray(links) ? links : [] });
  } catch (err) {
    console.error('[lkstv-download]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
