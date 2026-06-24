import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Trash2, Play, WifiOff, HardDrive, AlertCircle } from 'lucide-react';
import { useDownloads } from '../context/DownloadContext';
import { getVideoFile, getStorageEstimate, formatBytes, type DownloadMeta } from '../utils/offlineStorage';

// Lecteur vidéo inline pour lire un blob depuis OPFS
const OfflinePlayer: React.FC<{ id: string; title: string; onClose: () => void }> = ({ id, title, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    getVideoFile(id)
      .then((file) => {
        if (!file) { setError('Fichier introuvable dans le stockage local.'); return; }
        url = URL.createObjectURL(file);
        setBlobUrl(url);
      })
      .catch((e) => setError(String(e)));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-white truncate max-w-[70%]">{title}</span>
        <button onClick={onClose} className="text-white/60 hover:text-white text-sm px-3 py-1 rounded-full bg-white/10">
          Fermer
        </button>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-4 text-center">{error}</div>
      ) : !blobUrl ? (
        <div className="flex-1 flex items-center justify-center text-white/60 text-sm">Chargement…</div>
      ) : (
        <video
          className="flex-1 w-full"
          src={blobUrl}
          controls
          autoPlay
          playsInline
        />
      )}
    </div>
  );
};

// Carte d'un téléchargement
const DownloadCard: React.FC<{
  item: DownloadMeta;
  onPlay: (id: string) => void;
  onRemove: (id: string) => void;
}> = ({ item, onPlay, onRemove }) => {
  const size = item.totalSize > 0 ? item.totalSize : item.fileSize;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3 hover:bg-white/8 transition">
      {/* Thumbnail */}
      <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-white/10">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Download size={20} className="text-white/30" />
          </div>
        )}
        {item.status === 'downloading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="text-xs font-bold text-white">{item.progress}%</span>
          </div>
        )}
      </div>

      {/* Infos */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold text-white">{item.title}</p>
        {item.subtitle && (
          <p className="truncate text-xs text-white/50">{item.subtitle}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          {item.language && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white/60">
              {item.language}
            </span>
          )}
          {size > 0 && (
            <span className="text-[11px] text-white/40">{formatBytes(size)}</span>
          )}
          {item.status === 'downloading' && (
            <span className="text-[11px] text-blue-400">{formatBytes(item.fileSize)} / {size > 0 ? formatBytes(size) : '?'}</span>
          )}
          {item.status === 'error' && (
            <span className="flex items-center gap-1 text-[11px] text-red-400">
              <AlertCircle size={10} /> {item.error ?? 'Erreur'}
            </span>
          )}
        </div>

        {/* Barre de progression */}
        {item.status === 'downloading' && (
          <div className="mt-2 h-1 w-full rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        {item.status === 'completed' && (
          <button
            onClick={() => onPlay(item.id)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 transition"
            title="Lire hors-ligne"
          >
            <Play size={16} fill="white" />
          </button>
        )}
        <button
          onClick={() => onRemove(item.id)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-red-500/20 hover:text-red-400 transition"
          title="Supprimer"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
};

const DownloadsPage: React.FC = () => {
  const navigate = useNavigate();
  const { downloads, remove } = useDownloads();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);

  useEffect(() => {
    getStorageEstimate().then(setStorage);
  }, [downloads]);

  const playingItem = playingId ? downloads.find(d => d.id === playingId) : null;

  const handleRemove = useCallback(async (id: string) => {
    if (window.confirm('Supprimer ce téléchargement ?')) {
      await remove(id);
    }
  }, [remove]);

  const usedPercent = storage && storage.quota > 0
    ? Math.round((storage.used / storage.quota) * 100)
    : 0;

  return (
    <>
      {playingItem && (
        <OfflinePlayer
          id={playingItem.id}
          title={`${playingItem.title}${playingItem.subtitle ? ' · ' + playingItem.subtitle : ''}`}
          onClose={() => setPlayingId(null)}
        />
      )}

      <div className="min-h-screen bg-[#0f0f13] px-4 pb-20 pt-safe">
        {/* Header */}
        <div className="flex items-center justify-between py-4">
          <button onClick={() => navigate(-1)} className="text-white/60 hover:text-white text-sm">
            ← Retour
          </button>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <WifiOff size={18} className="text-blue-400" />
            Hors-ligne
          </h1>
          <div className="w-16" />
        </div>

        {/* Stockage utilisé */}
        {storage && storage.quota > 0 && (
          <div className="mb-4 rounded-xl bg-white/5 p-3">
            <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
              <span className="flex items-center gap-1.5">
                <HardDrive size={12} />
                Stockage appareil
              </span>
              <span>{formatBytes(storage.used)} / {formatBytes(storage.quota)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${usedPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Liste */}
        {downloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 pt-20 text-center">
            <Download size={48} className="text-white/20" />
            <p className="text-white/40 text-sm">
              Aucun téléchargement.<br />
              Appuie sur <Download size={12} className="inline" /> dans un film ou épisode.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {downloads.map((item) => (
              <DownloadCard
                key={item.id}
                item={item}
                onPlay={setPlayingId}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default DownloadsPage;
