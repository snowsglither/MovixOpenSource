import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchProfiles,
  createProfile,
  deleteProfile,
  updateProfile,
  setActiveProfile,
  verifyPin,
  LKSTV_PROFILE_KEY,
  type LKSTVProfile,
} from '../services/lkstvProfileService';

export { LKSTV_PROFILE_KEY as STORAGE_KEY };


const COLOR_PALETTE = [
  'bg-blue-600', 'bg-emerald-600', 'bg-orange-600', 'bg-pink-600',
  'bg-indigo-600', 'bg-gray-600', 'bg-red-600', 'bg-purple-600',
];

function getInitial(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  return t.charAt(0).toUpperCase();
}

interface ProfileSelectorProps {
  onSelect: (profileId: string) => void;
}

type Mode = 'select' | 'manage';

// PIN prompt modal — shown when deleting a PIN-protected profile
interface PinPromptProps {
  profileName: string;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
  error?: string;
}
const PinPrompt: React.FC<PinPromptProps> = ({ profileName, onConfirm, onCancel, error }) => {
  const [pin, setPin] = useState('');
  const inputs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  const handleDigit = (idx: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const digits = pin.split('');
    digits[idx] = val;
    const next = digits.join('').slice(0, 4);
    setPin(next);
    if (val && idx < 3) inputs[idx + 1].current?.focus();
  };

  const handleKey = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) inputs[idx - 1].current?.focus();
    if (e.key === 'Enter' && pin.length === 4) onConfirm(pin);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10001] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 bg-red-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="text-white font-bold text-lg mb-1">Code PIN requis</h3>
        <p className="text-gray-400 text-sm mb-5">Saisir le PIN du profil <span className="text-white font-medium">"{profileName}"</span></p>

        <div className="flex justify-center gap-3 mb-4">
          {[0, 1, 2, 3].map((idx) => (
            <input
              key={idx}
              ref={inputs[idx]}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={pin[idx] || ''}
              onChange={(e) => handleDigit(idx, e.target.value)}
              onKeyDown={(e) => handleKey(idx, e)}
              className="w-12 h-12 text-center text-xl font-bold bg-zinc-800 border border-zinc-600 rounded-lg text-white focus:outline-none focus:border-red-500"
              autoFocus={idx === 0}
            />
          ))}
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 border border-zinc-600 hover:border-zinc-400 text-white rounded-lg transition-colors text-sm"
          >
            Annuler
          </button>
          <button
            onClick={() => pin.length === 4 && onConfirm(pin)}
            disabled={pin.length !== 4}
            className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
          >
            Confirmer
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const ProfileSelector: React.FC<ProfileSelectorProps> = ({ onSelect }) => {
  const [profiles, setProfiles] = useState<LKSTVProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [toast, setToast] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0]);
  const [newPin, setNewPin] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit form
  const [editingProfile, setEditingProfile] = useState<LKSTVProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(COLOR_PALETTE[0]);
  const [editPin, setEditPin] = useState('');
  const [saving, setSaving] = useState(false);

  // PIN prompt for deletion
  const [pinPromptProfile, setPinPromptProfile] = useState<LKSTVProfile | null>(null);
  const [pinError, setPinError] = useState('');

  // PIN prompt for profile selection
  const [pinSelectProfile, setPinSelectProfile] = useState<LKSTVProfile | null>(null);
  const [pinSelectError, setPinSelectError] = useState('');
  const [pinSelectLoading, setPinSelectLoading] = useState(false);

  useEffect(() => {
    fetchProfiles()
      .then((p) => setProfiles(p))
      .catch(() => {
        // 401 ou erreur réseau → token invalide, rediriger vers login
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth');
        window.location.replace('/login');
      })
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const doSelect = (profile: LKSTVProfile) => {
    setSelected(profile.id);
    setActiveProfile(profile);
    localStorage.setItem('is_vip', 'true');
    localStorage.setItem('lkstv_last_profile', JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: true } }));
    setTimeout(() => onSelect(profile.id), 400);
  };

  const handleSelect = (profile: LKSTVProfile) => {
    if (profile.has_pin) {
      setPinSelectError('');
      setPinSelectProfile(profile);
      return;
    }
    doSelect(profile);
  };

  const handlePinSelectConfirm = async (pin: string) => {
    if (!pinSelectProfile || pinSelectLoading) return;
    setPinSelectLoading(true);
    const valid = await verifyPin(pinSelectProfile.id, pin);
    setPinSelectLoading(false);
    if (valid) {
      const profile = pinSelectProfile;
      setPinSelectProfile(null);
      doSelect(profile);
    } else {
      setPinSelectError('PIN incorrect, réessayez');
    }
  };

  const handleDeleteRequest = (profile: LKSTVProfile) => {
    if (profiles.length <= 1) { showToast('Impossible de supprimer le dernier profil'); return; }
    if (profile.has_pin) {
      setPinError('');
      setPinPromptProfile(profile);
    } else {
      doDelete(profile.id);
    }
  };

  const doDelete = async (id: string, pin?: string) => {
    try {
      await deleteProfile(id, pin);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      setPinPromptProfile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur suppression';
      if (msg.toLowerCase().includes('pin')) {
        setPinError('PIN incorrect, réessayez');
      } else {
        showToast(msg);
        setPinPromptProfile(null);
      }
    }
  };

  const handleCreate = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) { showToast('Le nom ne peut pas être vide'); return; }
    if (newPin && !/^\d{4}$/.test(newPin)) { showToast('Le PIN doit contenir exactement 4 chiffres'); return; }
    setCreating(true);
    try {
      const created = await createProfile(trimmedName, newColor, newPin || undefined);
      localStorage.setItem('is_vip', 'true');
      setProfiles((prev) => [...prev, created]);
      setNewName('');
      setNewColor(COLOR_PALETTE[0]);
      setNewPin('');
      showToast(`Profil "${trimmedName}" créé`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur création');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (profile: LKSTVProfile) => {
    setEditingProfile(profile);
    setEditName(profile.name);
    setEditColor(profile.avatar_color);
    setEditPin('');
  };

  const handleSaveEdit = async () => {
    if (!editingProfile) return;
    const trimmedName = editName.trim();
    if (!trimmedName) { showToast('Le nom ne peut pas être vide'); return; }
    if (editPin && !/^\d{4}$/.test(editPin)) { showToast('Le PIN doit contenir exactement 4 chiffres'); return; }
    setSaving(true);
    try {
      const updated = await updateProfile(editingProfile.id, trimmedName, editColor, editPin || undefined);
      setProfiles((prev) => prev.map((p) => p.id === editingProfile.id ? updated : p));
      setEditingProfile(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur mise à jour');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] bg-zinc-800 text-white px-5 py-3 rounded-lg shadow-xl text-sm"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PIN Prompt — suppression */}
      <AnimatePresence>
        {pinPromptProfile && (
          <PinPrompt
            profileName={pinPromptProfile.name}
            onConfirm={(pin) => doDelete(pinPromptProfile.id, pin)}
            onCancel={() => { setPinPromptProfile(null); setPinError(''); }}
            error={pinError}
          />
        )}
      </AnimatePresence>

      {/* PIN Prompt — sélection du profil */}
      <AnimatePresence>
        {pinSelectProfile && (
          <PinPrompt
            profileName={pinSelectProfile.name}
            onConfirm={handlePinSelectConfirm}
            onCancel={() => { setPinSelectProfile(null); setPinSelectError(''); }}
            error={pinSelectError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* ── MODE SÉLECTION ── */}
        {mode === 'select' && selected === null && (
          <motion.div
            key="selector"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-10 px-4 w-full"
          >
            <div className="text-center select-none">
              <h1 className="text-5xl sm:text-6xl font-black tracking-tight">
                <span className="text-white">LKS</span><span className="text-red-600"> TV</span>
              </h1>
            </div>
            <h2 className="text-xl sm:text-2xl text-gray-300 font-medium -mt-4">Qui regarde ?</h2>

            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-6 sm:gap-10">
                {profiles.map((profile) => (
                  <motion.button
                    key={profile.id}
                    whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}
                    onClick={() => handleSelect(profile)}
                    className="flex flex-col items-center gap-3 group outline-none"
                  >
                    <div className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-lg flex items-center justify-center text-white text-4xl sm:text-5xl font-bold ring-2 ring-transparent group-hover:ring-white transition-all duration-300 ${profile.avatar_color}`}>
                      {getInitial(profile.name)}
                      {profile.has_pin && (
                        <span className="absolute -bottom-1.5 -right-1.5 bg-zinc-900 rounded-full p-1 border border-zinc-700">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400 group-hover:text-white text-base sm:text-lg transition-colors">{profile.name}</span>
                  </motion.button>
                ))}
              </div>
            )}

            <button
              onClick={() => setMode('manage')}
              className="mt-2 text-sm text-gray-500 hover:text-gray-200 transition-colors border border-gray-700 hover:border-gray-400 px-5 py-2 rounded-md"
            >
              Gérer les profils
            </button>
          </motion.div>
        )}

        {/* ── CHARGEMENT POST-SÉLECTION ── */}
        {selected !== null && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
          </motion.div>
        )}

        {/* ── MODE GESTION ── */}
        {mode === 'manage' && selected === null && !editingProfile && (
          <motion.div
            key="manage"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-6 px-4 w-full max-w-lg overflow-y-auto max-h-screen py-8"
          >
            <div className="text-center select-none">
              <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
                <span className="text-white">LKS</span><span className="text-red-600"> TV</span>
              </h1>
            </div>
            <h2 className="text-lg sm:text-xl text-gray-300 font-medium -mt-4">Gérer les profils</h2>

            {/* Liste des profils */}
            <div className="w-full flex flex-col gap-2">
              {profiles.map((profile) => (
                <div key={profile.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-md flex items-center justify-center text-white font-bold text-base ${profile.avatar_color}`}>
                      {getInitial(profile.name)}
                    </div>
                    <div>
                      <span className="text-white text-sm font-medium">{profile.name}</span>
                      {profile.has_pin && <span className="ml-2 text-xs text-gray-500">🔒 PIN</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(profile)}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 transition-colors text-white text-xs"
                      aria-label={`Modifier ${profile.name}`}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteRequest(profile)}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-red-700 hover:bg-red-600 transition-colors text-white text-xs font-bold"
                      aria-label={`Supprimer ${profile.name}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Formulaire nouveau profil */}
            <div className="w-full bg-zinc-900 rounded-lg p-4 flex flex-col gap-4">
              <h3 className="text-gray-300 text-sm font-semibold">Ajouter un profil</h3>
              <input
                type="text"
                placeholder="Nom du profil"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={50}
                className="w-full bg-zinc-800 text-white placeholder-gray-500 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-zinc-500"
              />
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewColor(color)}
                    className={`w-8 h-8 rounded-md ${color} transition-all ${newColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-900 scale-110' : 'hover:scale-105'}`}
                    aria-label={color}
                  />
                ))}
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Code PIN (optionnel, 4 chiffres)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="Ex: 1234"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  maxLength={4}
                  className="w-full bg-zinc-800 text-white placeholder-gray-500 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-zinc-500 tracking-widest"
                />
                <p className="text-gray-600 text-xs mt-1">Si défini, le PIN sera demandé à l'accès et à la suppression</p>
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-md transition-colors"
              >
                {creating ? 'Création...' : 'Ajouter'}
              </button>
            </div>

            <button
              onClick={() => setMode('select')}
              className="text-sm text-gray-500 hover:text-gray-200 transition-colors border border-gray-700 hover:border-gray-400 px-5 py-2 rounded-md"
            >
              ← Retour
            </button>
          </motion.div>
        )}

        {/* ── MODE ÉDITION PROFIL ── */}
        {editingProfile && (
          <motion.div
            key="edit"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-6 px-4 w-full max-w-sm"
          >
            <h2 className="text-lg text-gray-200 font-semibold">Modifier le profil</h2>

            <div className={`w-20 h-20 rounded-lg flex items-center justify-center text-white text-3xl font-bold ${editColor}`}>
              {getInitial(editName || editingProfile.name)}
            </div>

            <div className="w-full flex flex-col gap-4">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                className="w-full bg-zinc-800 text-white placeholder-gray-500 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-zinc-500"
                placeholder="Nom du profil"
              />
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => setEditColor(color)}
                    className={`w-8 h-8 rounded-md ${color} transition-all ${editColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-900 scale-110' : 'hover:scale-105'}`}
                  />
                ))}
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">
                  {editingProfile.has_pin ? 'Nouveau PIN (laisser vide = conserver)' : 'Définir un PIN (optionnel, 4 chiffres)'}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder={editingProfile.has_pin ? '••••' : 'Ex: 1234'}
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  maxLength={4}
                  className="w-full bg-zinc-800 text-white placeholder-gray-500 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-zinc-500 tracking-widest"
                />
              </div>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={() => setEditingProfile(null)}
                className="flex-1 py-2 border border-zinc-600 hover:border-zinc-400 text-white rounded-lg transition-colors text-sm"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editName.trim()}
                className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white rounded-lg transition-colors text-sm font-medium"
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ProfileSelector;
