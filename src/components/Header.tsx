import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Search, X, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProfileMenu from './ProfileMenu';
import { encodeId } from '../utils/idEncoder';
import { useSearch } from '../context/SearchContext';

const NAV_ITEMS = [
  { label: 'Accueil',   path: '/' },
  { label: 'Films',     path: '/movies' },
  { label: 'Séries',    path: '/tv-shows' },
  { label: 'Anime',     path: '/anime' },
  { label: 'TV Direct', path: '/live-tv' },
];

const Header: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAuto, setShowAuto] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const { autocompleteSuggestions, loadingAutocomplete, fetchAutocompleteSuggestions, clearAutocompleteSuggestions } = useSearch();

  // Close on route change
  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
    setShowAuto(false);
    clearAutocompleteSuggestions();
    if (location.pathname !== '/search') setQuery('');
  }, [location.pathname]);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Click outside autocomplete
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autoRef.current && !autoRef.current.contains(e.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowAuto(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (v.length >= 2) { fetchAutocompleteSuggestions(v); setShowAuto(true); }
    else { clearAutocompleteSuggestions(); setShowAuto(false); }
  };

  const handleSelect = (item: any) => {
    clearAutocompleteSuggestions();
    setShowAuto(false);
    setQuery('');
    setSearchOpen(false);
    navigate(`/${item.media_type}/${encodeId(item.id)}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      setQuery('');
      setSearchOpen(false);
    }
  };

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <>
      <header className="!fixed inset-x-0 top-0 z-[11000] w-full">
        {/* Background blur */}
        <div className="absolute inset-0 backdrop-blur-xl bg-[#0a0a0f]/85 border-b border-white/[0.06]" />
        {/* Blue accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

        <div className="relative z-10 max-w-[1400px] mx-auto flex items-center h-16 px-4 md:px-6 lg:px-8 gap-4">

          {/* Logo */}
          <Link
            to="/"
            className="text-2xl font-extrabold flex-shrink-0 select-none"
            onClick={(e) => {
              if (location.pathname === '/') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            <span className="text-white tracking-wider">LKS</span>
            <span className="text-blue-500 tracking-wider"> TV</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 ml-6">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive(item.path)
                    ? 'text-white bg-blue-500/15 border border-blue-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Desktop search */}
          <div className="hidden lg:flex items-center relative">
            {searchOpen ? (
              <form onSubmit={handleSubmit} className="flex items-center">
                <div className="relative">
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={handleQueryChange}
                    placeholder="Rechercher..."
                    className="w-56 bg-white/8 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-all"
                  />
                  {/* Autocomplete */}
                  <AnimatePresence>
                    {showAuto && autocompleteSuggestions.length > 0 && (
                      <motion.div
                        ref={autoRef}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full mt-2 left-0 w-72 bg-[#13131f] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
                      >
                        {autocompleteSuggestions.slice(0, 6).map((item: any) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleSelect(item)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                          >
                            {item.poster_path ? (
                              <img
                                src={`https://image.tmdb.org/t/p/w45${item.poster_path}`}
                                alt=""
                                className="w-8 h-12 object-cover rounded flex-shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-12 bg-white/5 rounded flex-shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-white text-sm truncate">{item.title || item.name}</p>
                              <p className="text-gray-500 text-xs">{item.release_date?.slice(0, 4) || item.first_air_date?.slice(0, 4)}</p>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setQuery(''); clearAutocompleteSuggestions(); setShowAuto(false); }}
                  className="ml-2 text-gray-400 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 text-gray-400 hover:text-white transition-colors"
                aria-label="Rechercher"
              >
                <Search size={20} />
              </button>
            )}
          </div>

          {/* Profile */}
          <div className="hidden lg:block">
            <ProfileMenu />
          </div>

          {/* Mobile: search + hamburger */}
          <div className="flex lg:hidden items-center gap-2">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <Search size={20} />
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile search bar */}
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden relative z-10 border-t border-white/[0.06] bg-[#0a0a0f]/95 px-4 py-3"
            >
              <form onSubmit={handleSubmit}>
                <div className="relative flex items-center">
                  <Search size={16} className="absolute left-3 text-gray-500" />
                  <input
                    value={query}
                    onChange={handleQueryChange}
                    placeholder="Rechercher un film, une série..."
                    className="w-full bg-white/8 border border-white/15 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </form>
              {showAuto && autocompleteSuggestions.length > 0 && (
                <div className="mt-2 bg-[#13131f] border border-white/10 rounded-xl overflow-hidden">
                  {autocompleteSuggestions.slice(0, 5).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 text-left"
                    >
                      {item.poster_path ? (
                        <img src={`https://image.tmdb.org/t/p/w45${item.poster_path}`} alt="" className="w-7 h-10 object-cover rounded flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-10 bg-white/5 rounded flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-white text-sm truncate">{item.title || item.name}</p>
                        <p className="text-gray-500 text-xs">{item.release_date?.slice(0, 4) || item.first_air_date?.slice(0, 4)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Mobile menu overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-[10999] lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed top-0 right-0 bottom-0 w-72 bg-[#0e0e1a] border-l border-white/[0.08] z-[11000] lg:hidden flex flex-col pt-20 px-6 pb-6"
            >
              <nav className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-3 rounded-xl text-base font-medium transition-all ${
                      isActive(item.path)
                        ? 'text-white bg-blue-500/15 border border-blue-500/30'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 pt-6 border-t border-white/[0.08]">
                <ProfileMenu />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Header;
