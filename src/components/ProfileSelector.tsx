import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
  LKSTV_PROFILE_KEY,
  type LKSTVProfile,
} from '../services/lkstvProfileService';

export { LKSTV_PROFILE_KEY as STORAGE_KEY };

// Fallback hardcodé si l'API est injoignable
const FALLBACK_PROFILES: LKSTVProfile[] = [
  { id: 'profile-ruben',       name: 'Ruben',       avatar_color: 'bg-blue-600'    },
  { id: 'profile-glodi',       name: 'Glodi',       avatar_color: 'bg-emerald-600' },
  { id: 'profile-christopher', name: 'Christopher', avatar_color: 'bg-orange-600'  },
  { id: 'profile-pauliner',    name: 'Pauliner',    avatar_color: 'bg-pink-600'    },
  { id: 'profile-parents',     name: 'Parents',     avatar_color: 'bg-indigo-600'  },
  { id: 'profile-invite',      name: 'Invité',      avatar_color: 'bg-gray-600'    },
];

const COLOR_PALETTE = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-orange-600',
  'bg-pink-600',
  'bg-indigo-600',
  'bg-gray-600',
  'bg-red-600',
  'bg-purple-600',
];

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Pour les noms composés comme "Parents" → "Pa", sinon première lettre
  return trimmed.slice(0, 2).charAt(0).toUpperCase() + (trimmed.length > 1 ? trimmed.charAt(1) : '');
}

interface ProfileSelectorProps {
  onSelect: (profileId: string) => void;
}

type Mode = 'select' | 'manage';

const ProfileSelector: React.FC<ProfileSelectorProps> = ({ onSelect }) => {
  const [profiles, setProfiles] = useState<LKSTVProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [toast, setToast] = useState<string | null>(null);

  // Form state for new profile
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchProfiles()
      .then((p) => setProfiles(p.length > 0 ? p : FALLBACK_PROFILES))
      .catch(() => setProfiles(FALLBACK_PROFILES))
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSelect = (profile: LKSTVProfile) => {
    setSelected(profile.id);
    setActiveProfile(profile);
    setTimeout(() => {
      onSelect(profile.id);
    }, 400);
  };

  const handleDelete = async (profile: LKSTVProfile) => {
    if (profiles.length <= 1) {
      showToast('Impossible de supprimer le dernier profil');
      return;
    }
    try {
      await deleteProfile(profile.id);
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur suppression');
    }
  };

  const handleCreate = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      showToast('Le nom ne peut pas être vide');
      return;
    }
    setCreating(true);
    try {
      const created = await createProfile(trimmedName, newColor);
      setProfiles((prev) => [...prev, created]);
      setNewName('');
      setNewColor(COLOR_PALETTE[0]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur création');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] bg-zinc-800 text-white px-5 py-3 rounded-lg shadow-xl text-sm"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* ── MODE SÉLECTION ── */}
        {mode === 'select' && selected === null && (
          <motion.div
            key="selector"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-10 px-4 w-full"
          >
            {/* Logo */}
            <div className="text-center select-none">
              <h1 className="text-5xl sm:text-6xl font-black tracking-tight">
                <span className="text-white">LKS</span>
                <span className="text-red-600"> TV</span>
              </h1>
            </div>

            <h2 className="text-xl sm:text-2xl text-gray-300 font-medium -mt-4">
              Qui regarde ?
            </h2>

            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-6 sm:gap-10">
                {profiles.map((profile) => (
                  <motion.button
                    key={profile.id}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleSelect(profile)}
                    className="flex flex-col items-center gap-3 group outline-none"
                  >
                    <div
                      className={`
                        w-28 h-28 sm:w-32 sm:h-32 rounded-lg flex items-center justify-center
                        text-white text-4xl sm:text-5xl font-bold
                        ring-2 ring-transparent group-hover:ring-white transition-all duration-300
                        ${profile.avatar_color}
                      `}
                    >
                      {getInitial(profile.name)}
                    </div>
                    <span className="text-gray-400 group-hover:text-white text-base sm:text-lg transition-colors">
                      {profile.name}
                    </span>
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

        {/* ── ANIMATION CHARGEMENT POST-SÉLECTION ── */}
        {selected !== null && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center"
          >
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
          </motion.div>
        )}

        {/* ── MODE GESTION ── */}
        {mode === 'manage' && selected === null && (
          <motion.div
            key="manage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-8 px-4 w-full max-w-lg"
          >
            {/* Logo */}
            <div className="text-center select-none">
              <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
                <span className="text-white">LKS</span>
                <span className="text-red-600"> TV</span>
              </h1>
            </div>

            <h2 className="text-lg sm:text-xl text-gray-300 font-medium -mt-4">
              Gérer les profils
            </h2>

            {/* Liste des profils existants */}
            <div className="w-full flex flex-col gap-3">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between bg-zinc-900 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-md flex items-center justify-center text-white font-bold text-base ${profile.avatar_color}`}
                    >
                      {getInitial(profile.name)}
                    </div>
                    <span className="text-white text-sm font-medium">{profile.name}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(profile)}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-red-700 hover:bg-red-600 transition-colors text-white text-xs font-bold"
                    aria-label={`Supprimer ${profile.name}`}
                  >
                    ✕
                  </button>
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

              {/* Palette de couleurs */}
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewColor(color)}
                    className={`w-8 h-8 rounded-md ${color} transition-all ${
                      newColor === color
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-900 scale-110'
                        : 'hover:scale-105'
                    }`}
                    aria-label={color}
                  />
                ))}
              </div>

              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-md transition-colors"
              >
                {creating ? 'Création...' : 'Ajouter'}
              </button>
            </div>

            {/* Retour */}
            <button
              onClick={() => setMode('select')}
              className="text-sm text-gray-500 hover:text-gray-200 transition-colors border border-gray-700 hover:border-gray-400 px-5 py-2 rounded-md"
            >
              ← Retour
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ProfileSelector;
