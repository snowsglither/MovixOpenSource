/**
 * Local auth routes — username + password, admin-controlled accounts.
 * Mount point: app.use('/api/auth/local', router)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { issueJwt, getAuthIfValid, isAdmin } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:local-auth:login:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || ipKeyGenerator(req.ip),
  validate: { xForwardedForHeader: false, ip: false },
});

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else {
        try {
          resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derived));
        } catch {
          resolve(false);
        }
      }
    });
  });
}

async function createSession(userId, req) {
  const pool = getPool();
  if (!pool) return null;
  const sessionId = uuidv4();
  await pool.execute(
    'INSERT INTO user_sessions (id, user_id, user_type, user_agent) VALUES (?, ?, ?, ?)',
    [sessionId, userId, 'local', req.headers['user-agent'] || 'Unknown']
  );
  return sessionId;
}

// POST /api/auth/local/setup — crée le premier compte admin (table vide uniquement)
router.post('/setup', async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, error: 'Base de données non disponible' });

    const [rows] = await pool.execute('SELECT COUNT(*) as c FROM local_accounts');
    if (rows[0].c > 0) {
      return res.status(403).json({ success: false, error: 'Setup déjà effectué' });
    }

    const { username, password } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username invalide (min 3 caractères)' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Mot de passe invalide (min 6 caractères)' });
    }

    const id = uuidv4();
    const hash = await hashPassword(password);
    await pool.execute(
      'INSERT INTO local_accounts (id, username, password_hash) VALUES (?, ?, ?)',
      [id, username.trim(), hash]
    );
    await pool.execute(
      'INSERT IGNORE INTO admins (user_id, auth_type) VALUES (?, ?)',
      [id, 'local']
    );

    console.log(`[LOCAL AUTH] Premier compte admin créé : ${username.trim()} (${id})`);
    return res.json({ success: true, message: 'Compte admin créé avec succès' });
  } catch (err) {
    console.error('[LOCAL AUTH] Setup error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// POST /api/auth/local/login — connexion username + password
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, error: 'Base de données non disponible' });

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username et mot de passe requis' });
    }

    const [rows] = await pool.execute(
      'SELECT id, username, password_hash, is_active FROM local_accounts WHERE username = ?',
      [String(username).trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Identifiants incorrects' });
    }

    const account = rows[0];
    if (!account.is_active) {
      return res.status(403).json({ success: false, error: 'Compte désactivé' });
    }

    const valid = await verifyPassword(String(password), account.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Identifiants incorrects' });
    }

    const sessionId = await createSession(account.id, req);
    if (!sessionId) return res.status(500).json({ success: false, error: 'Erreur création session' });

    const token = issueJwt('local', account.id, sessionId, 'local');
    return res.json({
      success: true,
      token,
      account: { userId: account.id, username: account.username, userType: 'local' },
    });
  } catch (err) {
    console.error('[LOCAL AUTH] Login error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// POST /api/auth/local/change-password — l'utilisateur change son propre mot de passe
router.post('/change-password', async (req, res) => {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || auth.userType !== 'local') {
      return res.status(401).json({ success: false, error: 'Non authentifié' });
    }

    const pool = getPool();
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, error: 'Mot de passe actuel requis, nouveau min 6 caractères' });
    }

    const [rows] = await pool.execute(
      'SELECT password_hash FROM local_accounts WHERE id = ? AND is_active = 1',
      [auth.userId]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Compte introuvable' });

    const valid = await verifyPassword(String(currentPassword), rows[0].password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Mot de passe actuel incorrect' });

    const newHash = await hashPassword(String(newPassword));
    await pool.execute('UPDATE local_accounts SET password_hash = ? WHERE id = ?', [newHash, auth.userId]);

    return res.json({ success: true, message: 'Mot de passe mis à jour' });
  } catch (err) {
    console.error('[LOCAL AUTH] Change password error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// POST /api/auth/local/create — admin crée un compte utilisateur
router.post('/create', isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { username, password } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username invalide (min 3 caractères)' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Mot de passe invalide (min 6 caractères)' });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM local_accounts WHERE username = ?',
      [username.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: 'Ce username est déjà pris' });
    }

    const id = uuidv4();
    const hash = await hashPassword(password);
    await pool.execute(
      'INSERT INTO local_accounts (id, username, password_hash) VALUES (?, ?, ?)',
      [id, username.trim(), hash]
    );

    return res.json({ success: true, account: { id, username: username.trim() } });
  } catch (err) {
    console.error('[LOCAL AUTH] Create error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/auth/local/accounts — admin liste les comptes
router.get('/accounts', isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, username, is_active, created_at FROM local_accounts ORDER BY created_at ASC'
    );
    return res.json({ success: true, accounts: rows });
  } catch (err) {
    console.error('[LOCAL AUTH] List accounts error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// PUT /api/auth/local/accounts/:id/deactivate — admin désactive un compte
router.put('/accounts/:id/deactivate', isAdmin, async (req, res) => {
  try {
    if (req.admin.userId === req.params.id) {
      return res.status(400).json({ success: false, error: 'Impossible de désactiver votre propre compte' });
    }
    const pool = getPool();
    await pool.execute('UPDATE local_accounts SET is_active = 0 WHERE id = ?', [req.params.id]);
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ? AND user_type = ?', [req.params.id, 'local']);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// PUT /api/auth/local/accounts/:id/activate — admin réactive un compte
router.put('/accounts/:id/activate', isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.execute('UPDATE local_accounts SET is_active = 1 WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// PUT /api/auth/local/accounts/:id/reset-password — admin reset le mot de passe
router.put('/accounts/:id/reset-password', isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, error: 'Nouveau mot de passe (min 6 caractères) requis' });
    }
    const hash = await hashPassword(String(newPassword));
    await pool.execute('UPDATE local_accounts SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ? AND user_type = ?', [req.params.id, 'local']);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// DELETE /api/auth/local/accounts/:id — admin supprime définitivement un compte
router.delete('/accounts/:id', isAdmin, async (req, res) => {
  try {
    if (req.admin.userId === req.params.id) {
      return res.status(400).json({ success: false, error: 'Impossible de supprimer votre propre compte' });
    }
    const pool = getPool();
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ? AND user_type = ?', [req.params.id, 'local']);
    await pool.execute('DELETE FROM local_accounts WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
