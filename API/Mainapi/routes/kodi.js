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
let PROXY_BASE = 'http://localhost:25569';

function configure(deps) {
  if (deps.TMDB_API_KEY) TMDB_API_KEY = deps.TMDB_API_KEY;
  if (deps.TMDB_API_URL) TMDB_URL = deps.TMDB_API_URL;
  if (deps.INTERNAL_BASE) INTERNAL_BASE = deps.INTERNAL_BASE;
  if (deps.PROXY_BASE) PROXY_BASE = deps.PROXY_BASE;
}

// Extracteurs embed → m3u8 direct via le proxy Python
const EXTRACTORS = {
  'fsvid.lol':        (url) => `${PROXY_BASE}/api/extract-fsvid?url=${encodeURIComponent(url)}`,
  'vidzy.org':        (url) => `${PROXY_BASE}/api/extract-vidzy?url=${encodeURIComponent(url)}`,
  'uqload.is':        (url) => `${PROXY_BASE}/api/extract-uqload?url=${encodeURIComponent(url)}`,
  'uqload.co':        (url) => `${PROXY_BASE}/api/extract-uqload?url=${encodeURIComponent(url)}`,
  'doodstream.com':   (url) => `${PROXY_BASE}/api/extract-doodstream?url=${encodeURIComponent(url)}`,
  'ds2play.com':      (url) => `${PROXY_BASE}/api/extract-doodstream?url=${encodeURIComponent(url)}`,
  'vidmoly.to':       (url) => `${PROXY_BASE}/api/extract-vidmoly?url=${encodeURIComponent(url)}`,
};

function getExtractor(embedUrl) {
  try {
    const host = new URL(embedUrl).hostname.replace(/^www\./, '');
    for (const [domain, fn] of Object.entries(EXTRACTORS)) {
      if (host.includes(domain)) return fn;
    }
  } catch {}
  return null;
}

async function extractStream(embedUrl, label) {
  const fn = getExtractor(embedUrl);
  if (!fn) return null;
  try {
    const r = await axios.get(fn(embedUrl), { timeout: 15000 });
    const m3u8 = r.data?.m3u8Url || r.data?.url;
    if (!m3u8) return null;
    return { url: m3u8, label, format: 'hls' };
  } catch {
    return null;
  }
}

async function resolveStreamsFromFstream(tmdbId, type, season, episode) {
  try {
    let fstreamUrl;
    if (type === 'tv') {
      fstreamUrl = `${INTERNAL_BASE}/api/fstream/tv/${tmdbId}/season/${season}`;
    } else {
      fstreamUrl = `${INTERNAL_BASE}/api/fstream/movie/${tmdbId}`;
    }
    const r = await axios.get(fstreamUrl, { timeout: 15000 });
    const data = r.data;
    if (!data?.success) return [];

    // Rassemble tous les players (VFQ, VF, VOSTFR, etc.)
    const players = data.players || {};
    const embedList = [];
    for (const [lang, sources] of Object.entries(players)) {
      for (const src of (sources || [])) {
        if (src.url) embedList.push({ url: src.url, label: `${src.player || 'Stream'} ${lang}` });
      }
    }

    // Pour les séries, filtre par épisode si nécessaire
    // (fstream TV retourne les sources de la saison, pas par épisode directement)

    // Essaie d'extraire jusqu'à 3 streams en parallèle
    const candidates = embedList.slice(0, 6);
    const results = await Promise.all(candidates.map(e => extractStream(e.url, e.label)));
    return results.filter(Boolean);
  } catch (err) {
    console.error('[Kodi] fstream resolve error:', err.message);
    return [];
  }
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

    // 1. Essaie PurStream (URLs directes, le plus rapide)
    try {
      let purstreamUrl;
      let purstreamData;
      if (type === 'tv') {
        purstreamUrl = `${INTERNAL_BASE}/api/purstream/tv/${tmdb_id}/stream`;
        const r = await axios.get(purstreamUrl, { params: { season, episode }, timeout: 8000 });
        purstreamData = r.data;
      } else {
        purstreamUrl = `${INTERNAL_BASE}/api/purstream/movie/${tmdb_id}/stream`;
        const r = await axios.get(purstreamUrl, { timeout: 8000 });
        purstreamData = r.data;
      }
      if (purstreamData?.sources?.length > 0) {
        const streams = purstreamData.sources.map(s => ({ url: s.url, label: s.name || 'PurStream', format: s.format || 'hls' }));
        return res.json({ streams });
      }
    } catch { /* PurStream indispo, on continue */ }

    // 2. Fallback : FStream + extraction proxy Python
    const streams = await resolveStreamsFromFstream(tmdb_id, type, season, episode);
    res.json({ streams });
  } catch (err) {
    console.error('[Kodi] stream error:', err.message);
    res.json({ streams: [] });
  }
});

// ── Search ─────────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q) return res.json({ items: [] });
    const tmdbType = type === 'tv' ? 'tv' : type === 'both' ? null : (type || null);
    let results = [];

    if (!tmdbType || tmdbType === 'multi') {
      const data = await tmdb('/search/multi', { query: q });
      results = (data.results || []).filter(i => i.media_type === 'movie' || i.media_type === 'tv');
      results = results.map(i => formatItem(i, i.media_type));
    } else {
      const data = await tmdb(`/search/${tmdbType}`, { query: q });
      results = (data.results || []).map(i => formatItem(i, tmdbType));
    }

    res.json({ items: results.slice(0, 30) });
  } catch (err) {
    console.error('[Kodi] search error:', err.message);
    res.json({ items: [] });
  }
});

module.exports = { router, configure };
