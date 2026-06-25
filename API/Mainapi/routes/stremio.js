/**
 * LKS TV — Stremio Add-on
 *
 * Manifest : GET /stremio/manifest.json
 * Catalog  : GET /stremio/catalog/:type/:id.json
 * Meta     : GET /stremio/meta/:type/:id.json
 * Stream   : GET /stremio/stream/:type/:id.json
 *
 * Sources vidéo : PurStream (URLs directes HLS/MP4).
 * IDs           : IMDB (tt...) — standard Stremio.
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

let TMDB_API_KEY = '';
let TMDB_API_URL = 'https://api.themoviedb.org/3';
let INTERNAL_BASE = 'http://localhost:25565';

function configure(deps) {
  if (deps.TMDB_API_KEY) TMDB_API_KEY = deps.TMDB_API_KEY;
  if (deps.TMDB_API_URL) TMDB_API_URL = deps.TMDB_API_URL;
  if (deps.INTERNAL_BASE) INTERNAL_BASE = deps.INTERNAL_BASE;
}

// ── CORS obligatoire pour Stremio ──────────────────────────────────────────
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// ── Manifest ───────────────────────────────────────────────────────────────
const MANIFEST = {
  id: 'community.lkstv.addon',
  version: '1.0.0',
  name: 'LKS TV',
  description: 'Films et séries francophones en streaming.',
  logo: 'https://i.imgur.com/0VZILmt.png',
  background: 'https://i.imgur.com/0VZILmt.png',
  catalogs: [
    { type: 'movie',  id: 'lkstv_trending_movies',  name: '🔥 Tendances Films',    extra: [{ name: 'skip' }] },
    { type: 'movie',  id: 'lkstv_popular_movies',   name: '🎬 Films Populaires',   extra: [{ name: 'skip' }] },
    { type: 'series', id: 'lkstv_trending_series',  name: '📺 Séries Tendances',   extra: [{ name: 'skip' }] },
    { type: 'series', id: 'lkstv_popular_series',   name: '🌟 Séries Populaires',  extra: [{ name: 'skip' }] },
  ],
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  behaviorHints: { adult: false, p2p: false },
};

router.get('/manifest.json', (req, res) => res.json(MANIFEST));

// ── Helpers TMDB ───────────────────────────────────────────────────────────

function tmdbPosterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

function tmdbBackgroundUrl(path) {
  return path ? `https://image.tmdb.org/t/p/original${path}` : null;
}

function toStremioMeta(item, type) {
  const imdbId = item.external_ids?.imdb_id || item.imdb_id || null;
  return {
    id: imdbId,
    type,
    name: item.title || item.name,
    poster: tmdbPosterUrl(item.poster_path),
    background: tmdbBackgroundUrl(item.backdrop_path),
    description: item.overview,
    releaseInfo: (item.release_date || item.first_air_date || '').slice(0, 4),
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
    genres: item.genres?.map(g => g.name) || [],
    runtime: item.runtime ? `${item.runtime} min` : undefined,
  };
}

async function tmdbFetch(path, params = {}) {
  const r = await axios.get(`${TMDB_API_URL}${path}`, {
    params: { api_key: TMDB_API_KEY, language: 'fr-FR', ...params },
    timeout: 8000,
  });
  return r.data;
}

async function imdbToTmdb(imdbId, type) {
  const data = await tmdbFetch(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const key = type === 'movie' ? 'movie_results' : 'tv_results';
  const results = data[key] || [];
  return results[0] || null;
}

// ── Catalog ────────────────────────────────────────────────────────────────
router.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const skip = parseInt(req.query.skip || '0', 10);
    const page = Math.floor(skip / 20) + 1;

    const tmdbType = type === 'series' ? 'tv' : 'movie';
    let endpoint;

    if (id.includes('trending')) endpoint = `/trending/${tmdbType}/week`;
    else endpoint = `/discover/${tmdbType}`;

    const params = { page, sort_by: 'popularity.desc', 'vote_count.gte': 50 };
    if (tmdbType === 'movie') params.with_original_language = 'fr|en';

    const data = await tmdbFetch(endpoint, params);
    const items = data.results || [];

    // Récupérer les IMDB IDs via /external_ids (batch limité à 20 items max)
    const metas = await Promise.all(
      items.slice(0, 20).map(async (item) => {
        try {
          const ext = await tmdbFetch(`/${tmdbType}/${item.id}/external_ids`);
          const imdbId = ext.imdb_id;
          if (!imdbId) return null;
          return {
            id: imdbId,
            type,
            name: item.title || item.name,
            poster: tmdbPosterUrl(item.poster_path),
            releaseInfo: (item.release_date || item.first_air_date || '').slice(0, 4),
          };
        } catch { return null; }
      })
    );

    res.json({ metas: metas.filter(Boolean) });
  } catch (err) {
    console.error('[Stremio] catalog error:', err.message);
    res.json({ metas: [] });
  }
});

// ── Meta ───────────────────────────────────────────────────────────────────
router.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!id.startsWith('tt')) return res.json({ meta: null });

    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const found = await imdbToTmdb(id, type);
    if (!found) return res.json({ meta: null });

    const details = await tmdbFetch(`/${tmdbType}/${found.id}`, { append_to_response: 'external_ids,credits' });
    const meta = toStremioMeta({ ...details, imdb_id: id }, type);

    if (type === 'series' && details.number_of_seasons) {
      meta.videos = [];
      for (let s = 1; s <= details.number_of_seasons; s++) {
        try {
          const season = await tmdbFetch(`/tv/${found.id}/season/${s}`);
          for (const ep of season.episodes || []) {
            meta.videos.push({
              id: `${id}:${s}:${ep.episode_number}`,
              title: ep.name || `Épisode ${ep.episode_number}`,
              season: s,
              episode: ep.episode_number,
              released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
              thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : undefined,
              overview: ep.overview,
            });
          }
        } catch { /* ignore failed season fetch */ }
      }
    }

    res.json({ meta });
  } catch (err) {
    console.error('[Stremio] meta error:', err.message);
    res.json({ meta: null });
  }
});

// ── Stream ─────────────────────────────────────────────────────────────────
router.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!id.startsWith('tt')) return res.json({ streams: [] });

    const streams = [];
    const tmdbType = type === 'series' ? 'tv' : 'movie';

    // IMDB → TMDB ID
    const found = await imdbToTmdb(id, type);
    if (!found) return res.json({ streams: [] });

    const tmdbId = found.id;

    if (type === 'movie') {
      // PurStream
      try {
        const ps = await axios.get(`${INTERNAL_BASE}/api/purstream/movie/${tmdbId}/stream`, { timeout: 15000 });
        for (const src of (ps.data.sources || [])) {
          streams.push({
            url: src.url,
            name: `LKS TV • PurStream`,
            title: src.name || 'Stream',
            behaviorHints: { notWebReady: false, bingeGroup: 'lkstv' },
          });
        }
      } catch { /* PurStream non dispo */ }

    } else {
      // Série : id format tt1234567:saison:episode
      const parts = id.split(':');
      const season = parts[1] ? parseInt(parts[1], 10) : 1;
      const episode = parts[2] ? parseInt(parts[2], 10) : 1;

      try {
        const ps = await axios.get(`${INTERNAL_BASE}/api/purstream/tv/${tmdbId}/stream`, {
          params: { season, episode },
          timeout: 15000,
        });
        for (const src of (ps.data.sources || [])) {
          streams.push({
            url: src.url,
            name: `LKS TV • PurStream`,
            title: `S${season}E${episode} — ${src.name || 'Stream'}`,
            behaviorHints: { notWebReady: false, bingeGroup: 'lkstv' },
          });
        }
      } catch { /* PurStream non dispo */ }
    }

    res.json({ streams });
  } catch (err) {
    console.error('[Stremio] stream error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = { router, configure };
