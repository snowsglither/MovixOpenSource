import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, User, Lock, Trash2, Check, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import {
  getActiveProfile,
  setActiveProfile,
  updateProfile,
  clearAllHistory,
  type LKSTVProfile,
} from '../services/lkstvProfileService';

const AVATAR_COLORS = [
  { cls: 'bg-blue-600',    hex: '#2563eb' },
  { cls: 'bg-emerald-600', hex: '#059669' },
  { cls: 'bg-orange-600',  hex: '#ea580c' },
  { cls: 'bg-pink-600',    hex: '#db2777' },
  { cls: 'bg-indigo-600',  hex: '#4f46e5' },
  { cls: 'bg-red-600',     hex: '#dc2626' },
  { cls: 'bg-purple-600',  hex: '#9333ea' },
  { cls: 'bg-gray-600',    hex: '#4b5563' },
  { cls: 'bg-yellow-500',  hex: '#eab308' },
  { cls: 'bg-teal-600',    hex: '#0d9488' },
];

export default function ProfileSettingsPage() {
  const navigate = useNavigate();
  const profile = getActiveProfile();

  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.avatar_color ?? 'bg-blue-600');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [pinMode, setPinMode] = useState<'idle' | 'change' | 'remove'>('idle');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinSaved, setPinSaved] = useState(false);

  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!profile) navigate('/profile-selection');
  }, []);

  if (!profile) return null;

  const handleSaveProfile = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await updateProfile(profile.id, name.trim(), color);
      setActiveProfile({ ...profile, name: updated.name, avatar_color: updated.avatar_color });
      window.dispatchEvent(new Event('lkstv_profile_changed'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePin = async () => {
    setPinError('');
    if (pinMode === 'change') {
      if (!/^\d{4}$/.test(newPin)) { setPinError('Le PIN doit être 4 chiffres.'); return; }
      if (newPin !== confirmPin) { setPinError('Les PINs ne correspondent pas.'); return; }
    }
    try {
      await updateProfile(profile.id, profile.name, profile.avatar_color, pinMode === 'remove' ? '' : newPin);
      setActiveProfile({ ...profile, has_pin: pinMode !== 'remove' });
      window.dispatchEvent(new Event('lkstv_profile_changed'));
      setPinSaved(true);
      setTimeout(() => { setPinSaved(false); setPinMode('idle'); setCurrentPin(''); setNewPin(''); setConfirmPin(''); }, 2000);
    } catch {
      setPinError('Erreur lors de la modification du PIN.');
    }
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      await clearAllHistory(profile.id);
      setCleared(true);
      setClearConfirm(false);
      setTimeout(() => setCleared(false), 3000);
    } catch {
      /* ignore */
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/90 backdrop-blur-md border-b border-white/[0.06] px-4 py-4 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-semibold">Paramètres du profil</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* Avatar preview */}
        <div className="flex justify-center">
          <div className={`w-24 h-24 rounded-full ${color} flex items-center justify-center text-4xl font-bold text-white shadow-lg transition-colors duration-200`}>
            {name.trim().charAt(0).toUpperCase() || '?'}
          </div>
        </div>

        {/* Section: Nom & Couleur */}
        <div className="bg-[#13131f] rounded-2xl p-5 border border-white/[0.07] space-y-5">
          <div className="flex items-center gap-2 text-sm text-gray-400 font-medium uppercase tracking-wider">
            <User size={14} />
            <span>Profil</span>
          </div>

          {/* Nom */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Nom du profil</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
              placeholder="Nom du profil"
            />
          </div>

          {/* Couleur */}
          <div>
            <label className="block text-xs text-gray-500 mb-2">Couleur d'avatar</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map(c => (
                <button
                  key={c.cls}
                  onClick={() => setColor(c.cls)}
                  style={{ backgroundColor: c.hex }}
                  className={`w-9 h-9 rounded-full transition-all duration-150 ${color === c.cls ? 'ring-2 ring-white ring-offset-2 ring-offset-[#13131f] scale-110' : 'hover:scale-105'}`}
                />
              ))}
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={saving || !name.trim()}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saved ? <><Check size={16} /> Enregistré</> : saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>

        {/* Section: PIN */}
        <div className="bg-[#13131f] rounded-2xl p-5 border border-white/[0.07] space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 font-medium uppercase tracking-wider">
            <Lock size={14} />
            <span>Code PIN</span>
          </div>

          {pinMode === 'idle' && (
            <div className="flex gap-3">
              <button
                onClick={() => setPinMode('change')}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white transition-colors"
              >
                {profile.has_pin ? 'Changer le PIN' : 'Définir un PIN'}
              </button>
              {profile.has_pin && (
                <button
                  onClick={() => setPinMode('remove')}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-sm text-red-400 transition-colors"
                >
                  Supprimer le PIN
                </button>
              )}
            </div>
          )}

          <AnimatePresence>
            {pinMode !== 'idle' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {pinMode === 'remove' ? (
                  <p className="text-sm text-gray-400">Confirme la suppression du PIN de ce profil.</p>
                ) : (
                  <>
                    <div className="relative">
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={newPin}
                        onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="Nouveau PIN (4 chiffres)"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm tracking-widest focus:outline-none focus:border-blue-500/50 pr-10"
                      />
                      <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                        {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <input
                      type="password"
                      value={confirmPin}
                      onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Confirmer le PIN"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm tracking-widest focus:outline-none focus:border-blue-500/50"
                    />
                  </>
                )}
                {pinError && <p className="text-red-400 text-xs">{pinError}</p>}
                {pinSaved && <p className="text-green-400 text-xs flex items-center gap-1"><Check size={12} /> PIN mis à jour</p>}
                <div className="flex gap-3">
                  <button onClick={() => { setPinMode('idle'); setPinError(''); setNewPin(''); setConfirmPin(''); }}
                    className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-gray-300 transition-colors">
                    Annuler
                  </button>
                  <button onClick={handleSavePin}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${pinMode === 'remove' ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'} text-white`}>
                    {pinMode === 'remove' ? 'Supprimer' : 'Confirmer'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Section: Historique */}
        <div className="bg-[#13131f] rounded-2xl p-5 border border-white/[0.07] space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 font-medium uppercase tracking-wider">
            <Trash2 size={14} />
            <span>Historique</span>
          </div>

          {cleared && (
            <p className="text-green-400 text-sm flex items-center gap-2"><Check size={14} /> Historique vidé avec succès.</p>
          )}

          {!clearConfirm ? (
            <button
              onClick={() => setClearConfirm(true)}
              className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-sm text-red-400 transition-colors"
            >
              Vider l'historique de visionnage
            </button>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">Tout l'historique de <strong>{profile.name}</strong> sera supprimé. Cette action est irréversible.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setClearConfirm(false)} className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-gray-300 transition-colors">
                  Annuler
                </button>
                <button onClick={handleClearHistory} disabled={clearing}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
                  {clearing ? 'Suppression...' : 'Confirmer'}
                </button>
              </div>
            </motion.div>
          )}
        </div>

      </div>
    </div>
  );
}
