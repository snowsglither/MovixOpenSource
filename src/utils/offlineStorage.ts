/**
 * offlineStorage.ts
 * Couche de persistance pour les téléchargements hors-ligne.
 * - Métadonnées  → IndexedDB (légères, rapides)
 * - Blobs vidéo  → OPFS (Origin Private File System, pas de quota navigateur)
 */

const DB_NAME = 'lkstv-downloads';
const DB_VERSION = 1;
const META_STORE = 'metadata';

export type DownloadStatus = 'downloading' | 'completed' | 'error' | 'cancelled';

export interface DownloadMeta {
  id: string;
  type: 'movie' | 'tv' | 'anime';
  tmdbId: number;
  title: string;
  subtitle?: string;       // ex: "Saison 1 · Épisode 3"
  thumbnail?: string;      // URL TMDB poster
  language?: string;
  fileSize: number;        // bytes téléchargés (ou total si connu)
  totalSize: number;       // Content-Length, 0 si inconnu
  status: DownloadStatus;
  progress: number;        // 0-100
  createdAt: number;
  completedAt?: number;
  error?: string;
}

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(META_STORE, mode);
    const req = fn(t.objectStore(META_STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMeta(meta: DownloadMeta): Promise<void> {
  const db = await openDB();
  await tx(db, 'readwrite', (s) => s.put(meta));
}

export async function getMeta(id: string): Promise<DownloadMeta | null> {
  const db = await openDB();
  return (await tx<DownloadMeta | undefined>(db, 'readonly', (s) => s.get(id))) ?? null;
}

export async function getAllMeta(): Promise<DownloadMeta[]> {
  const db = await openDB();
  return tx<DownloadMeta[]>(db, 'readonly', (s) => s.getAll());
}

export async function deleteMeta(id: string): Promise<void> {
  const db = await openDB();
  await tx(db, 'readwrite', (s) => s.delete(id));
}

// ─── OPFS helpers ────────────────────────────────────────────────────────────

export function isOPFSSupported(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
}

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/**
 * Télécharge un flux HTTP et l'écrit dans OPFS avec suivi de progression.
 * @returns taille finale en bytes
 */
export async function writeVideoStream(
  id: string,
  response: Response,
  signal: AbortSignal,
  onProgress: (downloaded: number, total: number) => void,
): Promise<number> {
  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  const root = await getOPFSRoot();
  const fileHandle = await root.getFileHandle(`${id}.mp4`, { create: true });
  const writable = await fileHandle.createWritable();

  const reader = response.body!.getReader();
  let downloaded = 0;

  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      downloaded += value.byteLength;
      onProgress(downloaded, total);
    }
    await writable.close();
  } catch (err) {
    await writable.abort();
    // Nettoyage du fichier partiel
    try { await (await getOPFSRoot()).removeEntry(`${id}.mp4`); } catch { /* ignore */ }
    throw err;
  }

  return downloaded;
}

export async function getVideoFile(id: string): Promise<File | null> {
  if (!isOPFSSupported()) return null;
  try {
    const root = await getOPFSRoot();
    const handle = await root.getFileHandle(`${id}.mp4`);
    return handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteVideoFile(id: string): Promise<void> {
  if (!isOPFSSupported()) return;
  try {
    const root = await getOPFSRoot();
    await root.removeEntry(`${id}.mp4`);
  } catch { /* ignore if not found */ }
}

export async function hasVideoFile(id: string): Promise<boolean> {
  if (!isOPFSSupported()) return false;
  try {
    const root = await getOPFSRoot();
    await root.getFileHandle(`${id}.mp4`);
    return true;
  } catch {
    return false;
  }
}

/** Formate un nombre de bytes en chaîne lisible (KB / MB / GB) */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/** Estime l'espace disponible OPFS en bytes */
export async function getStorageEstimate(): Promise<{ used: number; quota: number }> {
  if (!('estimate' in navigator.storage)) return { used: 0, quota: 0 };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { used: usage, quota };
}
