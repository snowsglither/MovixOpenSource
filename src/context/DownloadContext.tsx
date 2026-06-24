import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getAllMeta, type DownloadMeta } from '../utils/offlineStorage';
import {
  startDownload,
  cancelDownload,
  deleteDownload,
  isDownloading,
  type DownloadRequest,
} from '../services/downloadManager';

interface DownloadContextType {
  downloads: DownloadMeta[];
  getDownload: (id: string) => DownloadMeta | undefined;
  enqueue: (req: DownloadRequest) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  isActive: (id: string) => boolean;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [downloads, setDownloads] = useState<DownloadMeta[]>([]);
  // Ref pour accéder à la liste la plus récente dans les callbacks sans stale closure
  const downloadsRef = useRef<DownloadMeta[]>([]);

  const refresh = useCallback(async () => {
    const all = await getAllMeta();
    // Sort: en cours > complétés récents > erreurs
    all.sort((a, b) => {
      if (a.status === 'downloading' && b.status !== 'downloading') return -1;
      if (b.status === 'downloading' && a.status !== 'downloading') return 1;
      return (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt);
    });
    downloadsRef.current = all;
    setDownloads(all);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const patchDownload = useCallback((id: string, patch: Partial<DownloadMeta>) => {
    setDownloads(prev => {
      const next = prev.map(d => d.id === id ? { ...d, ...patch } : d);
      downloadsRef.current = next;
      return next;
    });
  }, []);

  const enqueue = useCallback(async (req: DownloadRequest) => {
    // Évite les doublons actifs
    const existing = downloadsRef.current.find(d => d.id === req.id);
    if (existing?.status === 'downloading') return;

    // Injection optimiste dans la liste
    await refresh();

    try {
      await startDownload(req, ({ progress, fileSize, totalSize, status }) => {
        patchDownload(req.id, { progress, fileSize, totalSize, status });
      });
    } catch {
      // L'erreur est déjà persistée dans IndexedDB par startDownload
      await refresh();
    }
  }, [refresh, patchDownload]);

  const cancel = useCallback(async (id: string) => {
    await cancelDownload(id);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteDownload(id);
    setDownloads(prev => {
      const next = prev.filter(d => d.id !== id);
      downloadsRef.current = next;
      return next;
    });
  }, []);

  const getDownload = useCallback((id: string) => {
    return downloadsRef.current.find(d => d.id === id);
  }, []);

  const isActive = useCallback((id: string) => isDownloading(id), []);

  return (
    <DownloadContext.Provider value={{ downloads, getDownload, enqueue, cancel, remove, isActive }}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownloads = () => {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider');
  return ctx;
};
