/**
 * downloadManager.ts
 * Orchestre les téléchargements : résolution de la source MP4,
 * fetch streamé, écriture OPFS, gestion de l'AbortController.
 */

import { PROXIES_EMBED_API } from '../config/runtime';
import {
  saveMeta,
  deleteMeta,
  deleteVideoFile,
  writeVideoStream,
  isOPFSSupported,
  type DownloadMeta,
} from '../utils/offlineStorage';

export interface DownloadRequest {
  id: string;
  type: 'movie' | 'tv' | 'anime';
  tmdbId: number;
  title: string;
  subtitle?: string;
  thumbnail?: string;
  language?: string;
  /** URL MP4 directe ou URL proxy Sibnet déjà résolue */
  sourceUrl: string;
}

// AbortControllers pour annulation par id
const controllers = new Map<string, AbortController>();

type ProgressCallback = (meta: Pick<DownloadMeta, 'progress' | 'fileSize' | 'totalSize' | 'status'>) => void;

/**
 * Résout une URL Sibnet embed → URL proxy MP4 streamable.
 * Si l'URL est déjà une URL proxy (sibnet-proxy, embed-proxy…) ou une URL MP4
 * directe, elle est retournée telle quelle.
 */
export async function resolveMp4Url(url: string): Promise<string> {
  // Déjà une URL proxy ou MP4 directe
  if (!url.includes('sibnet.ru/shell.php')) return url;

  const resp = await fetch(
    `${PROXIES_EMBED_API}/api/extract-sibnet?url=${encodeURIComponent(url)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!resp.ok) throw new Error(`Sibnet extract failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.sourceUrl) throw new Error('Sibnet: sourceUrl manquante');
  return data.sourceUrl as string;
}

/**
 * Lance un téléchargement.
 * @param onProgress callback appelé à chaque chunk écrit
 */
export async function startDownload(
  req: DownloadRequest,
  onProgress: ProgressCallback,
): Promise<void> {
  if (!isOPFSSupported()) {
    throw new Error('OPFS non supporté sur ce navigateur');
  }

  const controller = new AbortController();
  controllers.set(req.id, controller);

  const meta: DownloadMeta = {
    id: req.id,
    type: req.type,
    tmdbId: req.tmdbId,
    title: req.title,
    subtitle: req.subtitle,
    thumbnail: req.thumbnail,
    language: req.language,
    fileSize: 0,
    totalSize: 0,
    status: 'downloading',
    progress: 0,
    createdAt: Date.now(),
  };

  await saveMeta(meta);
  onProgress({ progress: 0, fileSize: 0, totalSize: 0, status: 'downloading' });

  try {
    // 1. Résolution de l'URL MP4
    const mp4Url = await resolveMp4Url(req.sourceUrl);

    // 2. Fetch avec signal d'annulation
    const response = await fetch(mp4Url, {
      signal: controller.signal,
      headers: { 'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('Réponse sans body streamable');

    const total = parseInt(response.headers.get('content-length') ?? '0', 10);
    meta.totalSize = total;

    // 3. Écriture streamée dans OPFS
    const downloaded = await writeVideoStream(
      req.id,
      response,
      controller.signal,
      (dl, tot) => {
        const progress = tot > 0 ? Math.round((dl / tot) * 100) : 0;
        meta.fileSize = dl;
        meta.totalSize = tot;
        meta.progress = progress;
        onProgress({ progress, fileSize: dl, totalSize: tot, status: 'downloading' });
      },
    );

    // 4. Finalisation
    meta.fileSize = downloaded;
    meta.progress = 100;
    meta.status = 'completed';
    meta.completedAt = Date.now();
    await saveMeta(meta);
    onProgress({ progress: 100, fileSize: downloaded, totalSize: meta.totalSize, status: 'completed' });
  } catch (err) {
    const cancelled = (err instanceof DOMException && err.name === 'AbortError') || controller.signal.aborted;
    meta.status = cancelled ? 'cancelled' : 'error';
    meta.error = cancelled ? undefined : String(err);
    await saveMeta(meta);
    onProgress({ progress: meta.progress, fileSize: meta.fileSize, totalSize: meta.totalSize, status: meta.status });
    if (!cancelled) throw err;
  } finally {
    controllers.delete(req.id);
  }
}

export async function cancelDownload(id: string): Promise<void> {
  controllers.get(id)?.abort();
}

export async function deleteDownload(id: string): Promise<void> {
  controllers.get(id)?.abort();
  await Promise.all([deleteMeta(id), deleteVideoFile(id)]);
}

export function isDownloading(id: string): boolean {
  return controllers.has(id);
}

/** Formate les bytes en unité lisible */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
