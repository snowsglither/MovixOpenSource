/**
 * LKS TV — Kodi Add-on Backend
 *
 * GET /kodi/catalog?type=movie|tv&category=trending|popular&page=1
 * GET /kodi/detail?type=movie|tv&tmdb_id=123
 * GET /kodi/seasons/:tmdbId
 * GET /kodi/episodes/:tmdbId/:season
 * GET /kodi/stream?type=movie|tv&tmdb_id=123&season=1&episode=1
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

let TMDB_API_KEY = '';
let TMDB_URL = 'https://api.themoviedb.org/3';
let INTERNAL_BASE = 'http://localhost:25565';

function configure(deps) {
  if (deps.TMDB_API_KEY) TMDB_API_KEY = deps.TMDB_API_KEY;
  if (deps.TMDB_API_URL) TMDB_URL = deps.TMDB_API_URL;
  if (deps.INTERNAL_BASE) INTERNAL_BASE = deps.INTERNAL_BASE;
}

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdb(path, params = {}) {
  const r = await axios.get(`${TMDB_URL}${path}`, {
    params: { api_key: TMDB_API_KEY, language: 'fr-FR', ...params },
    timeout: 10000,
  });
  return r.data;
}

function poster(p) { return p ? `https://image.tmdb.org/t/p/w500${p}` : ''; }
function fanart(p) { return p ? `https://image.tmdb.org/t/p/original${p}` : ''; }

function formatItem(item, type) {
  return {
    tmdb_id: item.id,
    title: item.title || item.name,
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    overview: item.overview || '',
    poster: poster(item.poster_path),
    fanart: fanart(item.backdrop_path),
    rating: item.vote_average || 0,
    type,
  };
}

// ── Catalog ────────────────────────────────────────────────────────────────
router.get('/catalog', async (req, res) => {
  try {
    const type = req.query.type === 'tv' ? 'tv' : 'movie';
    const category = req.query.category || 'trending';
    const page = parseInt(req.query.page || '1', 10);

    let endpoint;
    let params = { page };

    if (category === 'trending') {
      endpoint = `/trending/${type}/week`;
    } else if (category === 'popular') {
      endpoint = `/${type}/popular`;
    } else if (category === 'top_rated') {
      endpoint = `/${type}/top_rated`;
    } else {
      endpoint = `/trending/${type}/week`;
    }

    const data = await tmdb(endpoint, params);
    const items = (data.results || []).map(i => formatItem(i, type));
    res.json({ items, total_pages: data.total_pages || 1 });
  } catch (err) {
    console.error('[Kodi] catalog error:', err.message);
    res.status(500).json({ items: [] });
  }
});

// ── Detail ────────────────────────────────────────────────────────────────
router.get('/detail', async (req, res) => {
  try {
    const { type, tmdb_id } = req.query;
    const tmdbType = type === 'tv' ? 'tv' : 'movie';
    const data = await tmdb(`/${tmdbType}/${tmdb_id}`);
    res.json(formatItem(data, tmdbType));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Seasons ────────────────────────────────────────────────────────────────
router.get('/seasons/:tmdbId', async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.tmdbId}`);
    const seasons = (data.seasons || [])
      .filter(s => s.season_number > 0)
      .map(s => ({
        season_number: s.season_number,
        name: s.name || `Saison ${s.season_number}`,
        episode_count: s.episode_count,
        poster: poster(s.poster_path),
        overview: s.overview || '',
      }));
    res.json({ seasons, show_title: data.name });
  } catch (err) {
    res.status(500).json({ seasons: [] });
  }
});

// ── Episodes ───────────────────────────────────────────────────────────────
router.get('/episodes/:tmdbId/:season', async (req, res) => {
  try {
    const { tmdbId, season } = req.params;
    const data = await tmdb(`/tv/${tmdbId}/season/${season}`);
    const episodes = (data.episodes || []).map(ep => ({
      episode_number: ep.episode_number,
      title: ep.name || `Épisode ${ep.episode_number}`,
      overview: ep.overview || '',
      thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : '',
      air_date: ep.air_date || '',
      rating: ep.vote_average || 0,
    }));
    res.json({ episodes, season_name: data.name });
  } catch (err) {
    res.status(500).json({ episodes: [] });
  }
});

// ── Stream ─────────────────────────────────────────────────────────────────
router.get('/stream', async (req, res) => {
  try {
    const { type, tmdb_id, season, episode } = req.query;
    let url, data;

    if (type === 'tv') {
      url = `${INTERNAL_BASE}/api/purstream/tv/${tmdb_id}/stream`;
      const r = await axios.get(url, { params: { season, episode }, timeout: 20000 });
      data = r.data;
    } else {
      url = `${INTERNAL_BASE}/api/purstream/movie/${tmdb_id}/stream`;
      const r = await axios.get(url, { timeout: 20000 });
      data = r.data;
    }

    const streams = (data.sources || []).map(s => ({
      url: s.url,
      label: s.name || 'Stream',
      format: s.format || 'hls',
    }));

    res.json({ streams });
  } catch (err) {
    console.error('[Kodi] stream error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = { router, configure };
