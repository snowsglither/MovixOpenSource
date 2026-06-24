import React, { useMemo } from 'react';
import { Download, CheckCircle, XCircle, Loader2, Trash2 } from 'lucide-react';
import { useDownloads } from '../context/DownloadContext';
import { isOPFSSupported, formatBytes } from '../utils/offlineStorage';
import type { DownloadRequest } from '../services/downloadManager';
import { cn } from '../lib/utils';

// Re-export depuis offlineStorage pour éviter d'importer dans le manager
export { formatBytes } from '../services/downloadManager';

interface DownloadButtonProps {
  request: Omit<DownloadRequest, 'id'> & { id?: string };
  /** Clé unique stable — fallback sur `${type}-${tmdbId}-${subtitle}` */
  downloadId?: string;
  className?: string;
  compact?: boolean; // icône seule sans texte
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({
  request,
  downloadId,
  className,
  compact = false,
}) => {
  const { downloads, getDownload, enqueue, cancel, remove } = useDownloads();

  const id = downloadId ?? `${request.type}-${request.tmdbId}-${request.subtitle ?? ''}`;
  const download = useMemo(() => getDownload(id), [downloads, id, getDownload]);

  if (!isOPFSSupported()) return null;
  if (!request.sourceUrl) return null;

  const status = download?.status;
  const progress = download?.progress ?? 0;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status === 'downloading') {
      await cancel(id);
      return;
    }
    if (status === 'completed') {
      await remove(id);
      return;
    }
    await enqueue({ ...request, id });
  };

  // ─── Cercle de progression SVG ───────────────────────────────────────────
  const size = 36;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dashoffset = circ * (1 - progress / 100);

  if (status === 'downloading') {
    return (
      <button
        onClick={handleClick}
        title="Annuler le téléchargement"
        className={cn(
          'relative flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-white backdrop-blur-sm transition hover:bg-white/20',
          className,
        )}
      >
        {/* Cercle de progression */}
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="#3b82f6" strokeWidth={stroke}
            strokeDasharray={circ} strokeDashoffset={dashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
          />
        </svg>
        {!compact && (
          <span className="text-sm font-medium tabular-nums">{progress}%</span>
        )}
        <XCircle size={14} className="text-white/60" />
      </button>
    );
  }

  if (status === 'completed') {
    return (
      <button
        onClick={handleClick}
        title="Supprimer le téléchargement"
        className={cn(
          'flex items-center gap-2 rounded-full bg-green-500/20 px-3 py-1.5 text-green-400 backdrop-blur-sm transition hover:bg-red-500/20 hover:text-red-400',
          className,
        )}
      >
        <CheckCircle size={16} />
        {!compact && <span className="text-sm font-medium">Téléchargé</span>}
        {!compact && <Trash2 size={12} className="opacity-60" />}
      </button>
    );
  }

  if (status === 'error') {
    return (
      <button
        onClick={handleClick}
        title="Réessayer le téléchargement"
        className={cn(
          'flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1.5 text-red-400 backdrop-blur-sm transition hover:bg-white/10 hover:text-white',
          className,
        )}
      >
        <XCircle size={16} />
        {!compact && <span className="text-sm font-medium">Réessayer</span>}
      </button>
    );
  }

  // État par défaut : idle / cancelled
  return (
    <button
      onClick={handleClick}
      title="Télécharger pour regarder hors-ligne"
      className={cn(
        'flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-white backdrop-blur-sm transition hover:bg-white/20 active:scale-95',
        className,
      )}
    >
      <Download size={16} />
      {!compact && <span className="text-sm font-medium">Télécharger</span>}
    </button>
  );
};
