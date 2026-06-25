import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Users } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { getActiveProfile, type LKSTVProfile } from '../services/lkstvProfileService';

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

const ProfileMenu: React.FC = () => {
  const [profile, setProfile] = useState<LKSTVProfile | null>(() => getActiveProfile());
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setProfile(getActiveProfile());
    window.addEventListener('lkstv_profile_changed', handler);
    return () => window.removeEventListener('lkstv_profile_changed', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleSwitchProfile = () => {
    setIsOpen(false);
    sessionStorage.removeItem('lkstv_active_profile');
    window.dispatchEvent(new Event('lkstv_reset_profile'));
  };

  if (!profile) return null;

  return (
    <div className="relative" ref={menuRef}>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer"
      >
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${profile.avatar_color}`}
        >
          {getInitial(profile.name)}
        </div>
        <span className="hidden sm:inline text-sm font-medium text-gray-200 max-w-[80px] lg:max-w-[100px] truncate">
          {profile.name}
        </span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-zinc-900 border border-white/10 shadow-2xl overflow-hidden z-50"
            >
              {/* Petite flèche */}
              <div className="absolute right-3 -top-2 w-4 h-4 bg-zinc-900 rotate-45 border-t border-l border-white/10" />

              {/* En-tête profil */}
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-base flex-shrink-0 ${profile.avatar_color}`}
                >
                  {getInitial(profile.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{profile.name}</div>
                  <div className="text-gray-500 text-xs">Profil actif</div>
                </div>
              </div>

              {/* Actions */}
              <div className="py-1">
                <Link
                  to="/profile-settings"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <Settings size={15} className="text-gray-500 flex-shrink-0" />
                  Paramètres
                </Link>
                <button
                  onClick={handleSwitchProfile}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                >
                  <Users size={15} className="text-gray-500 flex-shrink-0" />
                  Changer de profil
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ProfileMenu;
