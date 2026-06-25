/**
 * LKS TV — Local Profiles CRUD (auth JWT requise, profils isolés par compte).
 *
 * GET    /api/lkstv/profiles            → liste les profils du compte connecté
 * POST   /api/lkstv/profiles            → créer un profil (pin optionnel 4 chiffres)
 * PUT    /api/lkstv/profiles/:id        → mettre à jour (pin optionnel)
 * DELETE /api/lkstv/profiles/:id        → supprimer (pin requis dans body si profil protégé)
 * POST   /api/lkstv/profiles/:id/verify-pin → vérifier le PIN { pin } → { valid }
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../mysqlPool');
const { getAuthIfValid } = require('../middleware/auth');

async function requireAuth(req, res) {
  const auth = await getAuthIfValid(req);
  if (!auth) {
    res.status(401).json({ error: 'Non authentifié' });
    return null;
  }
  return auth;
}

function validateName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 50;
}

function validateAvatarColor(color) {
  if (typeof color !== 'string') return false;
  return color.trim().startsWith('bg-');
}

function validatePin(pin) {
  if (pin === null || pin === undefined || pin === '') return true; // optional
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

// GET /api/lkstv/profiles
router.get('/profiles', async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const pool = getPool();
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, avatar_color, created_at, (pin_code IS NOT NULL) as has_pin FROM local_profiles WHERE account_id = ? ORDER BY created_at ASC',
      [auth.userId]
    );
    return res.json({ profiles: rows.map(r => ({ ...r, has_pin: !!r.has_pin })) });
  } catch (err) {
    console.error('[lkstvProfiles] GET /profiles error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/lkstv/profiles
router.post('/profiles', async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { name, avatar_color, pin } = req.body || {};

  if (!validateName(name)) {
    return res.status(400).json({ error: 'name doit contenir entre 1 et 50 caractères' });
  }
  if (!validateAvatarColor(avatar_color)) {
    return res.status(400).json({ error: 'avatar_color doit commencer par bg-' });
  }
  if (!validatePin(pin)) {
    return res.status(400).json({ error: 'pin doit être 4 chiffres (ou absent)' });
  }

  const id = uuidv4();
  const trimmedName = name.trim();
  const trimmedColor = avatar_color.trim();
  const pinCode = (pin && pin.trim()) ? pin.trim() : null;
  const pool = getPool();

  try {
    await pool.execute(
      'INSERT INTO local_profiles (id, account_id, name, avatar_color, pin_code) VALUES (?, ?, ?, ?, ?)',
      [id, auth.userId, trimmedName, trimmedColor, pinCode]
    );
    const [rows] = await pool.execute(
      'SELECT id, name, avatar_color, created_at, (pin_code IS NOT NULL) as has_pin FROM local_profiles WHERE id = ?',
      [id]
    );
    const profile = { ...rows[0], has_pin: !!rows[0].has_pin };
    return res.status(201).json({ profile });
  } catch (err) {
    console.error('[lkstvProfiles] POST /profiles error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/lkstv/profiles/:id
router.put('/profiles/:id', async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { id } = req.params;
  const { name, avatar_color, pin } = req.body || {};

  if (name !== undefined && !validateName(name)) {
    return res.status(400).json({ error: 'name doit contenir entre 1 et 50 caractères' });
  }
  if (avatar_color !== undefined && !validateAvatarColor(avatar_color)) {
    return res.status(400).json({ error: 'avatar_color doit commencer par bg-' });
  }
  if (pin !== undefined && !validatePin(pin)) {
    return res.status(400).json({ error: 'pin doit être 4 chiffres ou chaîne vide pour supprimer' });
  }
  if (name === undefined && avatar_color === undefined && pin === undefined) {
    return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
  }

  const pool = getPool();
  try {
    const [existing] = await pool.execute(
      'SELECT id FROM local_profiles WHERE id = ? AND account_id = ?',
      [id, auth.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profil introuvable' });
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
    if (avatar_color !== undefined) { fields.push('avatar_color = ?'); values.push(avatar_color.trim()); }
    if (pin !== undefined) {
      fields.push('pin_code = ?');
      values.push((pin && pin.trim()) ? pin.trim() : null);
    }
    values.push(id);

    await pool.execute(`UPDATE local_profiles SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.execute(
      'SELECT id, name, avatar_color, created_at, (pin_code IS NOT NULL) as has_pin FROM local_profiles WHERE id = ?',
      [id]
    );
    return res.json({ profile: { ...rows[0], has_pin: !!rows[0].has_pin } });
  } catch (err) {
    console.error('[lkstvProfiles] PUT /profiles/:id error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/lkstv/profiles/:id
router.delete('/profiles/:id', async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { id } = req.params;
  const { pin } = req.body || {};
  const pool = getPool();

  try {
    const [all] = await pool.execute(
      'SELECT id FROM local_profiles WHERE account_id = ?',
      [auth.userId]
    );
    if (all.length <= 1) {
      return res.status(400).json({ error: 'Impossible de supprimer le dernier profil' });
    }

    const [existing] = await pool.execute(
      'SELECT id, pin_code FROM local_profiles WHERE id = ? AND account_id = ?',
      [id, auth.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profil introuvable' });
    }

    const storedPin = existing[0].pin_code;
    if (storedPin !== null) {
      if (!pin || String(pin).trim() !== storedPin) {
        return res.status(403).json({ error: 'PIN incorrect' });
      }
    }

    await pool.execute('DELETE FROM local_profiles WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[lkstvProfiles] DELETE /profiles/:id error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/lkstv/profiles/:id/verify-pin
router.post('/profiles/:id/verify-pin', async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { id } = req.params;
  const { pin } = req.body || {};
  const pool = getPool();

  try {
    const [rows] = await pool.execute(
      'SELECT pin_code FROM local_profiles WHERE id = ? AND account_id = ?',
      [id, auth.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Profil introuvable' });

    const storedPin = rows[0].pin_code;
    if (storedPin === null) return res.json({ valid: true }); // no PIN set

    const valid = String(pin || '').trim() === storedPin;
    return res.json({ valid });
  } catch (err) {
    console.error('[lkstvProfiles] POST /profiles/:id/verify-pin error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
