/**
 * vipService.ts - Service centralisé de vérification VIP côté frontend
 * VIP est forcé à true globalement — tout le monde accède aux extracteurs et flux directs.
 */

// Intervalle de vérification (conservé pour startVipVerification)
const VIP_CHECK_INTERVAL = 10 * 60 * 1000;

/**
 * Récupère la clé d'accès stockée dans localStorage
 */
export function getAccessKey(): string | null {
  return localStorage.getItem('access_code') || null;
}

/**
 * Toujours true — vérification serveur bypassée.
 */
export async function checkVipStatus(_force = false): Promise<boolean> {
  return true;
}

/**
 * No-op — révocation désactivée, VIP est forcé globalement.
 */
export function revokeVipStatus(): void {
  // VIP forcé globalement — révocation désactivée
}

/**
 * Retourne true pour tous les utilisateurs et synchronise localStorage.
 * Bypasse les gates d'extraction (canUseExtractor), le contexte AdFree et
 * les lectures directes de localStorage('is_vip') dans WatchTv/WatchMovie.
 */
export function isUserVip(): boolean {
  if (typeof window !== 'undefined') {
    localStorage.setItem('is_vip', 'true');
  }
  return true;
}

/**
 * Retourne les headers à inclure dans les requêtes API pour la vérification VIP côté serveur.
 */
export function getVipHeaders(): Record<string, string> {
  const accessKey = getAccessKey();
  if (accessKey) {
    return { 'x-access-key': accessKey };
  }
  return {};
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startVipVerification(): void {
  if (intervalId) {
    clearInterval(intervalId);
  }
  // Intervalle conservé pour compatibilité avec les appelants, mais checkVipStatus est no-op
  intervalId = setInterval(() => {
    checkVipStatus().catch(() => { /* ignore */ });
  }, VIP_CHECK_INTERVAL);
}

export function stopVipVerification(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
