import React, { useCallback, useEffect, useState, useMemo } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { Star, Calendar, Trash, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { encodeId } from '../utils/idEncoder';
import { useTmdbLogo } from '../hooks/useTmdbLogo';
import { useEmblaScrollSuppress } from '../hooks/useEmblaScrollSuppress';

const POSTER_FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg width="500" height="750" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" fill="#444" font-size="36" font-family="sans-serif" text-anchor="middle" dy=".3em">MOVIX</text></svg>')}`;

interface Media {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv' | 'collection';
  genre_ids?: number[];
}

interface ContinueWatching {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  media_type: 'movie' | 'tv';
  progress?: number;
  lastWatched: string;
  overview?: string;
  backdrop_path?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  currentEpisode?: {
    season: number;
    episode: number;
  };
}

interface EmblaCarouselProps {
  title: string | React.ReactNode;
  items: Media[] | ContinueWatching[];
  mediaType: string;
  isHistory?: boolean;
  onRemoveItem?: (itemId: number, mediaType: string) => void;
  onRemoveAll?: () => void;
  showRanking?: boolean;
  priorityZIndex?: boolean; // Pour les sections qui doivent être au-dessus des autres
  onViewAll?: () => void; // Callback pour le bouton "Voir tous"
}

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onError?: () => void;
  placeholder?: string;
  draggable?: boolean;
  priority?: boolean;
}

// Native lazy loading + async decode — décharge le decode du main thread
// pour éviter le jank pendant le scroll horizontal du carousel.
const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  className = '',
  style,
  onError,
  placeholder = 'data:image/svg+xml;utf8,<svg width="500" height="750" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="%23333"/><text x="50%" y="50%" fill="%23ccc" font-size="50" font-family="Arial, sans-serif" text-anchor="middle" dy=".3em">MOVIX</text></svg>',
  draggable = false,
  priority = false
}) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => {
    setErrored(true);
    setLoaded(true);
    onError?.();
  }, [onError]);

  const roundedClass = className.includes('rounded')
    ? className.match(/rounded-\w+/)?.[0] || ''
    : '';

  return (
    <div className={`relative ${className}`} style={{
      width: '100%',
      height: '100%',
      ...style
    }}>
      <img
        src={errored ? placeholder : src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={handleLoad}
        onError={handleError}
        draggable={draggable}
        className={`w-full h-full object-cover transition-opacity duration-300 ${roundedClass} ${loaded ? 'opacity-100' : 'opacity-0'}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...style
        }}
      />
      {!loaded && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-white rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  );
};

// Memoized card — same visual language as SearchGridCard
const CarouselCard = React.memo<{
  item: Media | ContinueWatching;
  index: number;
  itemId: string;
  detailPath: string;
  isVisible: boolean;
  initialStarred: boolean;
  progressData: { percentage: number; position: number; duration: number };
  isHistory: boolean;
  showRanking: boolean;
  handleAuxOpen: (e: React.MouseEvent, path: string) => void;
  onRemoveItem?: (itemId: number, mediaType: string) => void;
}>(({
  item,
  index,
  detailPath,
  isVisible,
  initialStarred,
  progressData,
  isHistory,
  showRanking,
  handleAuxOpen,
  onRemoveItem,
}) => {
  const { t } = useTranslation();
  const [starred, setStarred] = useState(initialStarred);
  const title = item.title || item.name || '';
  const isCollection = (item as any).media_type === 'collection';

  // Logo loading : déclenché dès que le slide entre dans la vue (via embla
  // `slidesInView`). Même comportement desktop / mobile. Les requêtes sont
  // mises en cache par useTmdbLogo (sessionStorage), donc les visites
  // suivantes du même item sont gratuites.
  const [shouldLoadLogo, setShouldLoadLogo] = useState(false);
  const triggerLogoLoad = useCallback(() => {
    setShouldLoadLogo(true);
  }, []);
  useEffect(() => {
    if (isVisible) setShouldLoadLogo(true);
  }, [isVisible]);
  const logoMediaType = shouldLoadLogo && !isCollection && (item.media_type === 'movie' || item.media_type === 'tv')
    ? item.media_type
    : undefined;
  const logoUrl = useTmdbLogo(logoMediaType, shouldLoadLogo ? item.id : undefined);

  const toggleWatchlist = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = isCollection ? 'watchlist_collections' : `watchlist_${item.media_type}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const exists = list.some((m: any) => m.id === item.id);
    if (exists) {
      localStorage.setItem(key, JSON.stringify(list.filter((m: any) => m.id !== item.id)));
      setStarred(false);
      toast.success(`${title} ${t('lists.removedFromList')}`, { duration: 2000 });
    } else {
      const newItem = isCollection
        ? {
            id: item.id,
            name: item.name || title,
            poster_path: item.poster_path,
            backdrop_path: (item as any).backdrop_path,
            overview: item.overview,
            type: 'collection',
            addedAt: new Date().toISOString(),
          }
        : {
            id: item.id,
            type: item.media_type,
            title,
            poster_path: item.poster_path,
            addedAt: new Date().toISOString(),
          };
      list.unshift(newItem);
      localStorage.setItem(key, JSON.stringify(list));
      setStarred(true);
      toast.success(`${title} ${t('lists.addedToList')}`, { duration: 2000 });
    }
  }, [item, title, t, isCollection]);

  const year = (item as any).release_date || (item as any).first_air_date
    ? new Date((item as any).release_date || (item as any).first_air_date).getFullYear()
    : null;

  const typeLabel = item.media_type === 'tv'
    ? t('common.series')
    : item.media_type === 'collection'
      ? t('common.saga')
      : t('common.movie');

  return (
    <div className="embla-slide flex-none relative w-[144px] md:w-[192px]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.5) }}
        onPointerEnter={triggerLogoLoad}
        className="relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 hover:scale-105 transition-[transform,border-color,background-color] duration-200 ease-out"
      >
        {/* Type badge */}
        <span className="absolute top-2 left-2 z-10 px-2 py-1 rounded-lg bg-black/75 text-[10px] font-semibold uppercase tracking-wider text-white/80">
          {typeLabel}
        </span>

        {/* Episode badge for history TV items */}
        {isHistory && 'currentEpisode' in item && item.currentEpisode && item.media_type === 'tv' && (
          <span className="absolute top-9 left-2 z-10 px-2 py-1 rounded-lg bg-red-600 text-[10px] font-semibold tracking-wider text-white">
            S{item.currentEpisode.season}:E{item.currentEpisode.episode}
          </span>
        )}

        {/* Top-right action: remove (history) or watchlist (normal) */}
        {isHistory && onRemoveItem ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveItem(item.id, item.media_type);
                }}
                whileTap={{ scale: 0.85 }}
                className="absolute top-2 right-2 z-20 p-2 rounded-full bg-red-600/95 hover:bg-red-600 text-white transition-colors"
                aria-label={t('common.deleteAll')}
              >
                <Trash className="w-3.5 h-3.5" />
              </motion.button>
            </TooltipTrigger>
            <TooltipContent>{t('common.deleteAll')}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                onClick={toggleWatchlist}
                whileTap={{ scale: 0.7 }}
                className={`absolute top-2 right-2 z-20 p-2 rounded-full transition-[opacity,background-color] duration-200 md:opacity-0 md:group-hover:opacity-100 ${starred ? 'bg-yellow-500/40 border border-yellow-400/50' : 'bg-black/65 hover:bg-black/80'}`}
              >
                <motion.div
                  key={starred ? 'on' : 'off'}
                  initial={{ scale: 0.3, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                >
                  <Star
                    className={`w-4 h-4 transition-colors duration-150 ${starred ? 'text-yellow-400' : 'text-white'}`}
                    fill={starred ? 'currentColor' : 'none'}
                  />
                </motion.div>
              </motion.button>
            </TooltipTrigger>
            <TooltipContent>
              {starred ? t('profile.removeFromWatchlist') : t('profile.addToWatchlist')}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Poster */}
        <div className="w-full aspect-[2/3] relative">
          <LazyImage
            src={`https://image.tmdb.org/t/p/w500${item.poster_path}`}
            alt={title || t('common.poster')}
            className="rounded-xl w-full h-full"
            placeholder={POSTER_FALLBACK}
            priority={isVisible}
          />
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

        {/* Hover content */}
        <div className="absolute bottom-0 left-0 right-0 p-3 md:opacity-0 md:group-hover:opacity-100 md:translate-y-2 md:group-hover:translate-y-0 transition-[opacity,transform] duration-300 pointer-events-none">
          {logoUrl ? (
            <div className="mb-1.5 h-7 flex items-end">
              <img
                src={logoUrl}
                alt={title}
                className="max-h-full max-w-full object-contain object-left drop-shadow-md"
                draggable={false}
                loading="lazy"
              />
            </div>
          ) : (
            <h3 className="text-sm font-bold text-white line-clamp-1 mb-1">
              {title}
            </h3>
          )}
          <div className="flex items-center gap-2 mb-1">
            {(item as any).vote_average ? (
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 text-yellow-400" />
                <span className="text-xs text-white/80">
                  {(item as any).vote_average.toFixed(1)}
                </span>
              </div>
            ) : null}
            {year && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-white/60" />
                <span className="text-xs text-white/60">{year}</span>
              </div>
            )}
          </div>
          {item.overview && (
            <p className="text-xs text-white/50 line-clamp-3">
              {item.overview}
            </p>
          )}
        </div>

        {/* Progress bar for history items */}
        {isHistory && progressData.percentage > 0 && (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-black/50 overflow-hidden rounded-b-xl z-10">
            <div
              className="h-full bg-red-600"
              style={{ width: `${progressData.percentage}%` }}
            />
          </div>
        )}

        {/* Main clickable area */}
        <Link
          to={detailPath}
          onAuxClick={(e) => handleAuxOpen(e, detailPath)}
          className="absolute inset-0 z-[5]"
        >
          <span className="sr-only">{title}</span>
        </Link>
      </motion.div>

      {/* Top 10 ranking number — outside motion.div to escape its overflow-hidden */}
      {showRanking && (
        <div
          className="ranking-number"
          style={{ backgroundImage: `url(https://image.tmdb.org/t/p/w500${item.poster_path})` }}
        >
          {index + 1}
        </div>
      )}
    </div>
  );
});

CarouselCard.displayName = 'CarouselCard';

const arraysEqual = (a: number[], b: number[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const EmblaCarousel: React.FC<EmblaCarouselProps> = ({
  title,
  items,
  mediaType: _mediaType,
  isHistory = false,
  onRemoveItem,
  onRemoveAll,
  showRanking = false,
  priorityZIndex = false,
  onViewAll
}) => {
  const { t } = useTranslation();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'keepSnaps',
    slidesToScroll: 1,
    skipSnaps: false,
    duration: 25,
    startIndex: 0,
    loop: false
  });
  const [visibleSlides, setVisibleSlides] = useState<number[]>([]);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  // Cache watchlists once using useMemo to avoid repeated localStorage access
  const watchlistMovies = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('watchlist_movie') || '[]'); } catch { return []; }
  }, []);

  const watchlistTV = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('watchlist_tv') || '[]'); } catch { return []; }
  }, []);

  const watchlistCollections = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('watchlist_collections') || '[]'); } catch { return []; }
  }, []);

  // Limite le nombre d'items pour éviter de surcharger le DOM (max 30 items par carousel)
  const limitedItems = useMemo(() => items.slice(0, 30), [items]);

  // Effect 1: track visible slides for image priority via 'slidesInView' event.
  // Embla fires this only when slides actually enter/leave the viewport — not
  // every scroll frame. We extend ±1 for preloading.
  useEffect(() => {
    if (!emblaApi) return;
    const updateVisible = () => {
      const inView = emblaApi.slidesInView();
      const extendedSet = new Set<number>(inView);
      inView.forEach((i) => {
        if (i > 0) extendedSet.add(i - 1);
        if (i < limitedItems.length - 1) extendedSet.add(i + 1);
      });
      const next = Array.from(extendedSet).sort((a, b) => a - b);
      setVisibleSlides((prev) => (arraysEqual(prev, next) ? prev : next));
    };
    updateVisible();
    emblaApi.on('slidesInView', updateVisible);
    emblaApi.on('reInit', updateVisible);
    return () => {
      emblaApi.off('slidesInView', updateVisible);
      emblaApi.off('reInit', updateVisible);
    };
  }, [emblaApi, limitedItems.length]);

  // Effect 2: track arrow-button state via 'select' + 'reInit' only.
  useEffect(() => {
    if (!emblaApi) return;
    const updateArrows = () => {
      try {
        setCanScrollPrev(emblaApi.canScrollPrev());
        setCanScrollNext(emblaApi.canScrollNext());
      } catch (_) {
        // no-op
      }
    };
    updateArrows();
    emblaApi.on('select', updateArrows);
    emblaApi.on('reInit', updateArrows);
    return () => {
      emblaApi.off('select', updateArrows);
      emblaApi.off('reInit', updateArrows);
    };
  }, [emblaApi]);

  // Support molette horizontale (tilt wheel / trackpad) -> scroll du carousel
  useEffect(() => {
    if (!emblaApi) return;
    const rootNode = emblaApi.rootNode();
    if (!rootNode) return;

    let lastWheel = 0;
    const THROTTLE_MS = 90;

    const onWheel = (e: WheelEvent) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX <= absY || absX < 2) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel < THROTTLE_MS) return;
      lastWheel = now;
      if (e.deltaX > 0) emblaApi.scrollNext();
      else emblaApi.scrollPrev();
    };

    rootNode.addEventListener('wheel', onWheel, { passive: false });
    return () => rootNode.removeEventListener('wheel', onWheel);
  }, [emblaApi]);

  // Suppression hover pendant scroll horizontal du carousel (drag pointerUp lift,
  // settle pour wheel/scrollPrev/Next). Pose body.embla-scrolling -> CSS rule
  // `body.embla-scrolling .embla-slide { pointer-events: none }` (src/index.css)
  // empêche les hover flips quand les cards défilent sous le curseur.
  useEmblaScrollSuppress(emblaApi);

  const getStep = useCallback(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (w >= 1536) return 8; // 2K+
    if (w >= 1280) return 6; // xl
    if (w >= 1024) return 5; // lg
    if (w >= 768) return 4;  // md
    return 2;                // sm/xs
  }, []);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const target = Math.max(0, current - getStep());
      emblaApi.scrollTo(target);
    } catch (_) {
      emblaApi.scrollPrev();
    }
  }, [emblaApi, getStep]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const snaps = emblaApi.scrollSnapList().length;
      const target = Math.min(snaps - 1, current + getStep());
      emblaApi.scrollTo(target);
    } catch (_) {
      emblaApi.scrollNext();
    }
  }, [emblaApi, getStep]);

  // Open in new tab on middle-click
  const handleAuxOpen = useCallback((e: React.MouseEvent, path: string) => {
    // Middle mouse button is button === 1
    if ((e as React.MouseEvent).button === 1) {
      e.preventDefault();
      e.stopPropagation();
      try {
        window.open(path, '_blank', 'noopener,noreferrer');
      } catch (_) {
        // Fallback without features string
        window.open(path, '_blank');
      }
    }
  }, []);

  // Function to get movie progress data - memoized
  const getMovieProgress = useCallback((movieId: number): { percentage: number, position?: number, duration?: number } => {
    try {
      const progressKey = `progress_${movieId}`;
      const savedData = localStorage.getItem(progressKey);

      if (savedData) {
        const progressData = JSON.parse(savedData);
        if (progressData.position && progressData.duration) {
          return {
            percentage: Math.min((progressData.position / progressData.duration) * 100, 100),
            position: progressData.position,
            duration: progressData.duration
          };
        }
      }
      return { percentage: 0 };
    } catch (error) {
      console.error('Error getting movie progress:', error);
      return { percentage: 0 };
    }
  }, []);

  // Function to get episode progress data - memoized
  const getEpisodeProgress = useCallback((showId: number, seasonNumber: number, episodeNumber: number): { percentage: number, position?: number, duration?: number } => {
    try {
      const progressKey = `progress_tv_${showId}_s${seasonNumber}_e${episodeNumber}`;
      const savedData = localStorage.getItem(progressKey);

      if (savedData) {
        const progressData = JSON.parse(savedData);
        if (progressData.position && progressData.duration) {
          return {
            percentage: Math.min((progressData.position / progressData.duration) * 100, 100),
            position: progressData.position,
            duration: progressData.duration
          };
        }
      }
      return { percentage: 0 };
    } catch (error) {
      console.error('Error getting episode progress:', error);
      return { percentage: 0 };
    }
  }, []);

  return (
    <>
      <style>
        {`
          .embla-slide {
            position: relative;
            flex-shrink: 0;
            contain: layout;
          }

          /* Pendant le scroll (150ms idle après le dernier input), on coupe les
             pointer events sur les slides : ça empêche le :hover de flipper en
             permanence quand les cards défilent sous le curseur (chaque flip
             déclenchait un cycle Layerize+Paint au compositor). Le body.is-scrolling
             est posé par SmoothScroll.tsx. */
          body.is-scrolling .embla-slide {
            pointer-events: none;
          }

          /* Top 10 ranking number — digit filled with poster (static, no animation
             to avoid continuous repaint of the background-clip: text mask) */
          .ranking-number {
            position: absolute;
            left: -1rem;
            bottom: -0.5rem;
            z-index: 5;
            font-size: 6rem;
            font-weight: 900;
            line-height: 0.85;
            user-select: none;
            pointer-events: none;
            font-family: 'Arial Black', 'Helvetica Neue', Impact, Arial, sans-serif;
            letter-spacing: -0.08em;
            color: transparent;
            background-size: 200% auto;
            background-position: center;
            background-repeat: no-repeat;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-stroke: 1.5px rgba(239, 68, 68, 0.6);
            text-stroke: 1.5px rgba(239, 68, 68, 0.6);
            filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.6));
          }

          @media (min-width: 768px) {
            .ranking-number {
              left: -1.5rem;
              bottom: -0.75rem;
              font-size: 9rem;
              -webkit-text-stroke: 2px rgba(239, 68, 68, 0.6);
              text-stroke: 2px rgba(239, 68, 68, 0.6);
            }
          }
        `}
      </style>
      <div className="mb-4 content-row-container select-none -mx-3 md:-mx-4 group/carousel" style={{ position: 'relative' }}>
        <div className="flex justify-between items-center mb-2 px-4 md:px-6 relative">
          <div className="flex items-center gap-3">
            <h2 className="section-title">{title}</h2>
            {onViewAll && (
              <button
                onClick={onViewAll}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-300 hover:text-white bg-gray-800/50 hover:bg-gray-700/70 rounded-full transition-all duration-200 border border-gray-700/50 hover:border-gray-600"
              >
                <span>{t('common.viewAll')}</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {isHistory && onRemoveAll && items.length > 0 && (
            <button
              onClick={onRemoveAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700/80 hover:bg-red-700 text-white text-xs font-medium rounded-full transition-colors"
              aria-label="Supprimer tout"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('common.deleteAll')}</span>
            </button>
          )}
        </div>

        <div className="relative w-full overflow-visible">
          <div className="overflow-visible" ref={emblaRef}>
            <div
              className="flex gap-4 pr-4 md:pr-6 pl-4 md:pl-6"
              style={{ overflow: 'visible' }}
            >
              {limitedItems.map((item, index) => {
                const itemId = `carousel-${item.id}-${item.media_type}-${index}`;
                const detailPath = item.media_type === 'collection' ? `/collection/${item.id}` : `/${item.media_type}/${encodeId(item.id)}`;
                const isVisible = visibleSlides.includes(index);
                const initialStarred = (() => {
                  const list = (item as any).media_type === 'collection'
                    ? watchlistCollections
                    : item.media_type === 'movie'
                      ? watchlistMovies
                      : watchlistTV;
                  return Array.isArray(list) && list.some((media: any) => media.id === item.id);
                })();

                // Calculate progress for history items
                const progressData = { percentage: 0, position: 0, duration: 0 };

                if (isHistory && 'currentEpisode' in item) {
                  const historyItem = item as ContinueWatching;
                  if (historyItem.media_type === 'tv' && historyItem.currentEpisode) {
                    const epProgress = getEpisodeProgress(historyItem.id, historyItem.currentEpisode.season, historyItem.currentEpisode.episode);
                    progressData.percentage = epProgress.percentage;
                    progressData.position = epProgress.position || 0;
                    progressData.duration = epProgress.duration || 0;
                  } else if (historyItem.media_type === 'movie') {
                    const movieProgress = getMovieProgress(historyItem.id);
                    progressData.percentage = movieProgress.percentage;
                    progressData.position = movieProgress.position || 0;
                    progressData.duration = movieProgress.duration || 0;
                  }
                }

                return (
                  <CarouselCard
                    key={itemId}
                    item={item}
                    index={index}
                    itemId={itemId}
                    detailPath={detailPath}
                    isVisible={isVisible}
                    initialStarred={initialStarred}
                    progressData={progressData}
                    isHistory={isHistory}
                    showRanking={showRanking}
                    handleAuxOpen={handleAuxOpen}
                    onRemoveItem={onRemoveItem}
                  />
                );
              })}
              {/* Spacer to ensure last card hover is fully visible */}
              <div className="flex-none w-8 md:w-24" aria-hidden="true" />
            </div>
          </div>
          {/* Boutons de navigation - verticaux noirs avec slide-in au hover */}
          <button
            type="button"
            aria-label={t('common.previous')}
            onClick={handlePrev}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className={`hidden md:flex absolute left-6 md:left-8 top-1/2 z-[950]
                     w-12 h-32 rounded-2xl items-center justify-center text-white/90 hover:text-white
                     bg-gradient-to-b from-neutral-900/70 via-black/80 to-neutral-900/70 backdrop-blur-md
                     ring-1 ring-white/10 hover:ring-red-500/40
                     shadow-2xl shadow-black/70
                     transition-all duration-300 ease-out
                     -translate-y-1/2
                     opacity-0 -translate-x-2
                     group-hover/carousel:opacity-100 group-hover/carousel:translate-x-0
                     ${!canScrollPrev ? 'pointer-events-none !opacity-0' : 'pointer-events-auto'}`}
          >
            <ChevronLeft className="w-7 h-7" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label={t('common.next')}
            onClick={handleNext}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className={`hidden md:flex absolute right-6 md:right-8 top-1/2 z-[950]
                     w-12 h-32 rounded-2xl items-center justify-center text-white/90 hover:text-white
                     bg-gradient-to-b from-neutral-900/70 via-black/80 to-neutral-900/70 backdrop-blur-md
                     ring-1 ring-white/10 hover:ring-red-500/40
                     shadow-2xl shadow-black/70
                     transition-all duration-300 ease-out
                     -translate-y-1/2
                     opacity-0 translate-x-2
                     group-hover/carousel:opacity-100 group-hover/carousel:translate-x-0
                     ${!canScrollNext ? 'pointer-events-none !opacity-0' : 'pointer-events-auto'}`}
          >
            <ChevronRight className="w-7 h-7" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </>
  );
};

export default React.memo(EmblaCarousel);