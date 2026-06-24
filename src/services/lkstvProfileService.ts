const API = import.meta.env.VITE_MAIN_API;

export interface LKSTVProfile {
  id: string;
  name: string;
  avatar_color: string;
  has_pin?: boolean;
  created_at?: string;
}

export interface LKSTVHistoryEntry {
  id?: number;
  profile_id: string;
  media_type: 'movie' | 'tv' | 'anime';
  media_id: number;
  title?: string;
  poster_path?: string;
  progress?: number;
  duration?: number;
  season?: number | null;
  episode?: number | null;
  watched_at?: string;
}

// Storage key for active profile
export const LKSTV_PROFILE_KEY = 'lkstv_active_profile';

export function getActiveProfile(): LKSTVProfile | null {
  try {
    const raw = sessionStorage.getItem(LKSTV_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Préfixe une clé localStorage avec l'ID du profil actif pour isolation totale. */
export function profileStorageKey(base: string): string {
  const profile = getActiveProfile();
  return profile ? `${profile.id}_${base}` : base;
}

export function setActiveProfile(profile: LKSTVProfile): void {
  sessionStorage.setItem(LKSTV_PROFILE_KEY, JSON.stringify(profile));
}

export function clearActiveProfile(): void {
  sessionStorage.removeItem(LKSTV_PROFILE_KEY);
}

// Profile CRUD
export async function fetchProfiles(): Promise<LKSTVProfile[]> {
  const r = await fetch(`${API}/api/lkstv/profiles`);
  const d = await r.json();
  return d.profiles || [];
}

export async function createProfile(name: string, avatar_color: string, pin?: string): Promise<LKSTVProfile> {
  const r = await fetch(`${API}/api/lkstv/profiles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, avatar_color, ...(pin ? { pin } : {}) })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Erreur création profil');
  return d.profile;
}

export async function updateProfile(id: string, name: string, avatar_color: string, pin?: string): Promise<LKSTVProfile> {
  const body: Record<string, string> = { name, avatar_color };
  if (pin !== undefined) body.pin = pin; // empty string = remove PIN
  const r = await fetch(`${API}/api/lkstv/profiles/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Erreur mise à jour');
  return d.profile;
}

export async function deleteProfile(id: string, pin?: string): Promise<void> {
  const r = await fetch(`${API}/api/lkstv/profiles/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: pin !== undefined ? JSON.stringify({ pin }) : undefined,
  });
  if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur suppression'); }
}

export async function verifyPin(id: string, pin: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/lkstv/profiles/${id}/verify-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const d = await r.json();
    return !!d.valid;
  } catch { return false; }
}

// History
export async function upsertHistory(entry: Omit<LKSTVHistoryEntry, 'id' | 'watched_at'>): Promise<void> {
  await fetch(`${API}/api/lkstv/history`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-profile-id': entry.profile_id },
    body: JSON.stringify(entry)
  });
}

export async function fetchHistory(profileId: string): Promise<LKSTVHistoryEntry[]> {
  const r = await fetch(`${API}/api/lkstv/history`, { headers: { 'x-profile-id': profileId } });
  const d = await r.json();
  return d.history || [];
}

export async function removeFromHistory(profileId: string, mediaType: string, mediaId: number): Promise<void> {
  await fetch(`${API}/api/lkstv/history/${mediaType}/${mediaId}`, {
    method: 'DELETE', headers: { 'x-profile-id': profileId }
  });
}

// Watchlist
export async function fetchWatchlist(profileId: string) {
  const r = await fetch(`${API}/api/lkstv/watchlist`, { headers: { 'x-profile-id': profileId } });
  const d = await r.json();
  return d.watchlist || [];
}

export async function addToWatchlist(entry: { profile_id: string; media_type: 'movie' | 'tv'; media_id: number; title?: string; poster_path?: string }) {
  await fetch(`${API}/api/lkstv/watchlist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-profile-id': entry.profile_id },
    body: JSON.stringify(entry)
  });
}

export async function removeFromWatchlist(profileId: string, mediaType: string, mediaId: number) {
  await fetch(`${API}/api/lkstv/watchlist/${mediaType}/${mediaId}`, {
    method: 'DELETE', headers: { 'x-profile-id': profileId }
  });
}
