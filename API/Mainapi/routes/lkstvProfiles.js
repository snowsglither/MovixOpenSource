/**
 * LKS TV — Local Profiles CRUD (sans auth JWT).
 *
 * GET    /api/lkstv/profiles        → liste tous les profils
 * POST   /api/lkstv/profiles        → créer un profil
 * PUT    /api/lkstv/profiles/:id    → mettre à jour un profil
 * DELETE /api/lkstv/profiles/:id    → supprimer un profil
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../mysqlPool');

// Validation helpers
function validateName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 50;
}

function validateAvatarColor(color) {
  if (typeof color !== 'string') return false;
  return color.trim().startsWith('bg-');
}

// GET /api/lkstv/profiles
router.get('/profiles', async (_req, res) => {
  const pool = getPool();
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, avatar_color, created_at FROM local_profiles ORDER BY created_at ASC'
    );
    return res.json({ profiles: rows });
  } catch (err) {
    console.error('[lkstvProfiles] GET /profiles error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/lkstv/profiles
router.post('/profiles', async (req, res) => {
  const { name, avatar_color } = req.body || {};

  if (!validateName(name)) {
    return res.status(400).json({ error: 'name doit contenir entre 1 et 50 caractères' });
  }
  if (!validateAvatarColor(avatar_color)) {
    return res.status(400).json({ error: 'avatar_color doit commencer par bg-' });
  }

  const id = uuidv4();
  const trimmedName = name.trim();
  const trimmedColor = avatar_color.trim();
  const pool = getPool();

  try {
    await pool.execute(
      'INSERT INTO local_profiles (id, name, avatar_color) VALUES (?, ?, ?)',
      [id, trimmedName, trimmedColor]
    );
    const [rows] = await pool.execute(
      'SELECT id, name, avatar_color, created_at FROM local_profiles WHERE id = ?',
      [id]
    );
    return res.status(201).json({ profile: rows[0] });
  } catch (err) {
    console.error('[lkstvProfiles] POST /profiles error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/lkstv/profiles/:id
router.put('/profiles/:id', async (req, res) => {
  const { id } = req.params;
  const { name, avatar_color } = req.body || {};

  if (name !== undefined && !validateName(name)) {
    return res.status(400).json({ error: 'name doit contenir entre 1 et 50 caractères' });
  }
  if (avatar_color !== undefined && !validateAvatarColor(avatar_color)) {
    return res.status(400).json({ error: 'avatar_color doit commencer par bg-' });
  }
  if (name === undefined && avatar_color === undefined) {
    return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
  }

  const pool = getPool();
  try {
    const [existing] = await pool.execute(
      'SELECT id FROM local_profiles WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profil introuvable' });
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
    if (avatar_color !== undefined) { fields.push('avatar_color = ?'); values.push(avatar_color.trim()); }
    values.push(id);

    await pool.execute(
      `UPDATE local_profiles SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    const [rows] = await pool.execute(
      'SELECT id, name, avatar_color, created_at FROM local_profiles WHERE id = ?',
      [id]
    );
    return res.json({ profile: rows[0] });
  } catch (err) {
    console.error('[lkstvProfiles] PUT /profiles/:id error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/lkstv/profiles/:id
router.delete('/profiles/:id', async (req, res) => {
  const { id } = req.params;
  const pool = getPool();

  try {
    const [all] = await pool.execute(
      'SELECT id FROM local_profiles'
    );
    if (all.length <= 1) {
      return res.status(400).json({ error: 'Impossible de supprimer le dernier profil' });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM local_profiles WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profil introuvable' });
    }

    await pool.execute('DELETE FROM local_profiles WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvProfiles] DELETE /profiles/:id error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
