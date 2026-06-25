import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, Lock, Power, RefreshCw, Eye, EyeOff, Check, X, Monitor, LogOut, Sliders } from 'lucide-react';

const API_URL = import.meta.env.VITE_MAIN_API as string;

interface LocalAccount {
  id: string;
  username: string;
  is_active: number;
  max_sessions: number;
  active_sessions: number;
  created_at: string;
}

interface Session {
  id: string;
  user_agent: string;
  created_at: string;
  accessed_at: string;
  is_active: number;
}

const LocalAccountsManager: React.FC = () => {
  const authToken = localStorage.getItem('auth_token') || '';
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [sessionsAccountId, setSessionsAccountId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [editingMaxSessions, setEditingMaxSessions] = useState<string | null>(null);
  const [maxSessionsValue, setMaxSessionsValue] = useState('2');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/local/accounts`, { headers });
      const data = await res.json();
      if (data.success) setAccounts(data.accounts);
      else setError(data.error || 'Erreur chargement');
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/local/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setCreateSuccess(`Compte "${newUsername.trim()}" créé`);
        setNewUsername(''); setNewPassword('');
        fetchAccounts();
      } else {
        setCreateError(data.error || 'Erreur création');
      }
    } catch { setCreateError('Erreur réseau'); }
    finally { setCreating(false); }
  };

  const toggleActive = async (id: string, currentlyActive: boolean) => {
    const action = currentlyActive ? 'deactivate' : 'activate';
    try {
      const res = await fetch(`${API_URL}/api/auth/local/accounts/${id}/${action}`, { method: 'PUT', headers });
      const data = await res.json();
      if (data.success) fetchAccounts();
    } catch { /* ignore */ }
  };

  const deleteAccount = async (id: string, username: string) => {
    if (!confirm(`Supprimer définitivement "${username}" ?`)) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/local/accounts/${id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (data.success) fetchAccounts();
      else alert(data.error || 'Erreur suppression');
    } catch { /* ignore */ }
  };

  const resetAccountPassword = async (id: string) => {
    if (!resetPassword || resetPassword.length < 6) { alert('Min 6 caractères'); return; }
    setResetting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/local/accounts/${id}/reset-password`, {
        method: 'PUT', headers,
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      const data = await res.json();
      if (data.success) { setResetId(null); setResetPassword(''); }
      else alert(data.error || 'Erreur reset');
    } catch { /* ignore */ }
    finally { setResetting(false); }
  };

  const openSessions = async (id: string) => {
    setSessionsAccountId(id);
    setSessionsLoading(true);
    setSessions([]);
    try {
      const res = await fetch(`${API_URL}/api/auth/local/accounts/${id}/sessions`, { headers });
      const data = await res.json();
      if (data.success) setSessions(data.sessions);
    } catch { /* ignore */ }
    finally { setSessionsLoading(false); }
  };

  const kickSession = async (sessionId: string) => {
    try {
      await fetch(`${API_URL}/api/auth/local/sessions/${sessionId}`, { method: 'DELETE', headers });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      fetchAccounts();
    } catch { /* ignore */ }
  };

  const saveMaxSessions = async (id: string) => {
    const max = parseInt(maxSessionsValue, 10);
    if (isNaN(max) || max < 0 || max > 10) { alert('Entre 0 et 10 (0 = illimité)'); return; }
    try {
      const res = await fetch(`${API_URL}/api/auth/local/accounts/${id}/max-sessions`, {
        method: 'PUT', headers,
        body: JSON.stringify({ max_sessions: max }),
      });
      const data = await res.json();
      if (data.success) { setEditingMaxSessions(null); fetchAccounts(); }
      else alert(data.error || 'Erreur');
    } catch { /* ignore */ }
  };

  const formatUA = (ua: string) => {
    if (!ua) return 'Appareil inconnu';
    if (ua.includes('iPhone') || ua.includes('iPad')) return '📱 iOS';
    if (ua.includes('Android')) return '📱 Android';
    if (ua.includes('Windows')) return '💻 Windows';
    if (ua.includes('Mac')) return '💻 Mac';
    if (ua.includes('Linux')) return '🖥️ Linux';
    return ua.slice(0, 40);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Gestion des comptes</h3>
        <button onClick={fetchAccounts} className="p-2 text-gray-400 hover:text-white transition-colors" title="Rafraîchir">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Formulaire création */}
      <form onSubmit={createAccount} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Créer un compte
        </h4>
        <div className="flex gap-3">
          <input
            type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Username"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500"
          />
          <div className="relative flex-1">
            <input
              type={showNewPassword ? 'text' : 'password'} value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} placeholder="Mot de passe (min 6)"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500"
            />
            <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button type="submit" disabled={creating || !newUsername.trim() || !newPassword}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {creating ? '...' : 'Créer'}
          </button>
        </div>
        {createError && <p className="text-red-400 text-xs">{createError}</p>}
        {createSuccess && <p className="text-green-400 text-xs">{createSuccess}</p>}
      </form>

      {/* Liste des comptes */}
      {loading ? (
        <p className="text-gray-400 text-sm">Chargement...</p>
      ) : error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : accounts.length === 0 ? (
        <p className="text-gray-500 text-sm">Aucun compte local</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="rounded-xl border border-gray-700 bg-gray-800/40 overflow-hidden">
              {/* Ligne principale */}
              <div className={`flex items-center gap-3 p-3 ${!acc.is_active ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{acc.username}</p>
                  <p className="text-xs text-gray-500">
                    {acc.is_active ? 'Actif' : 'Désactivé'} · Créé le {new Date(acc.created_at).toLocaleDateString('fr-FR')}
                  </p>
                </div>

                {/* Badge sessions actives */}
                <button
                  onClick={() => sessionsAccountId === acc.id ? setSessionsAccountId(null) : openSessions(acc.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                    acc.active_sessions > 0
                      ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                      : 'bg-gray-700/50 border-gray-600 text-gray-400 hover:bg-gray-700'
                  }`}
                  title="Voir les sessions"
                >
                  <Monitor className="w-3 h-3" />
                  {acc.active_sessions}/{acc.max_sessions === 0 ? '∞' : acc.max_sessions}
                </button>

                {/* Actions */}
                {resetId === acc.id ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type={showResetPassword ? 'text' : 'password'} value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)} placeholder="Nouveau mdp"
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 pr-8 text-white text-xs w-32 focus:outline-none focus:border-red-500"
                      />
                      <button type="button" onClick={() => setShowResetPassword(!showResetPassword)} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500">
                        {showResetPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    <button onClick={() => resetAccountPassword(acc.id)} disabled={resetting} className="p-1.5 text-green-400 hover:text-green-300">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setResetId(null); setResetPassword(''); }} className="p-1.5 text-gray-400 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : editingMaxSessions === acc.id ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min="0" max="10" value={maxSessionsValue}
                        onChange={(e) => setMaxSessionsValue(e.target.value)}
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white text-xs w-16 focus:outline-none focus:border-red-500"
                      />
                      <span className="text-xs text-gray-400">appareil(s)</span>
                    </div>
                    <button onClick={() => saveMaxSessions(acc.id)} className="p-1.5 text-green-400 hover:text-green-300">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingMaxSessions(null)} className="p-1.5 text-gray-400 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingMaxSessions(acc.id); setMaxSessionsValue(String(acc.max_sessions)); }}
                      className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors"
                      title="Changer limite d'appareils"
                    >
                      <Sliders className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setResetId(acc.id); setResetPassword(''); }} className="p-1.5 text-gray-400 hover:text-yellow-400 transition-colors" title="Réinitialiser le mot de passe">
                      <Lock className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleActive(acc.id, Boolean(acc.is_active))}
                      className={`p-1.5 transition-colors ${acc.is_active ? 'text-gray-400 hover:text-orange-400' : 'text-gray-600 hover:text-green-400'}`}
                      title={acc.is_active ? 'Désactiver' : 'Réactiver'}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteAccount(acc.id, acc.username)} className="p-1.5 text-gray-400 hover:text-red-400 transition-colors" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Panel sessions */}
              {sessionsAccountId === acc.id && (
                <div className="border-t border-gray-700 bg-gray-900/60 p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sessions (15 min = actif)</p>
                  {sessionsLoading ? (
                    <p className="text-xs text-gray-500">Chargement...</p>
                  ) : sessions.length === 0 ? (
                    <p className="text-xs text-gray-500">Aucune session</p>
                  ) : (
                    sessions.map((s) => (
                      <div key={s.id} className={`flex items-center justify-between gap-2 p-2 rounded-lg ${s.is_active ? 'bg-green-500/5 border border-green-500/20' : 'bg-gray-800/40 border border-gray-700/50'}`}>
                        <div className="min-w-0">
                          <p className="text-xs text-white">{formatUA(s.user_agent)}</p>
                          <p className="text-xs text-gray-500">
                            Dernière activité : {new Date(s.accessed_at).toLocaleString('fr-FR')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${s.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                            {s.is_active ? 'En ligne' : 'Inactif'}
                          </span>
                          <button onClick={() => kickSession(s.id)} className="p-1 text-gray-500 hover:text-red-400 transition-colors" title="Déconnecter">
                            <LogOut className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocalAccountsManager;
