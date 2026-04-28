// Détecte si une erreur de lecture HLS ressemble à un blocage DNS au niveau
// FAI (typiquement un FAI français qui bloque un domaine par décision ARCOM).
// Retourne true uniquement si on est confiant que c'est DNS et pas un autre
// type de panne réseau (offline, host isolé mort, etc.).

export interface HlsErrorLike {
  type?: string;
  details?: string;
  fatal?: boolean;
  response?: { code?: number; text?: string } | null;
  networkDetails?: { status?: number } | null;
  reason?: string;
  error?: Error | null;
}

const DNS_LIKE_MESSAGE_RE =
  /ERR_NAME_NOT_RESOLVED|Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE/i;

const MANIFEST_OR_LEVEL_DETAILS = new Set([
  'manifestLoadError',
  'manifestLoadTimeOut',
  'levelLoadError',
  'levelLoadTimeOut',
]);

export function isDnsLikeError(
  data: HlsErrorLike | null | undefined,
  videoError?: MediaError | null | undefined
): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }

  if (data) {
    const isManifestOrLevelError =
      data.type === 'networkError' &&
      typeof data.details === 'string' &&
      MANIFEST_OR_LEVEL_DETAILS.has(data.details);

    if (isManifestOrLevelError) {
      const responseCode = data.response?.code;
      const networkStatus = data.networkDetails?.status;
      const reason = data.reason ?? data.error?.message ?? '';

      if (responseCode === 0 || responseCode === undefined) {
        if (networkStatus === 0 || networkStatus === undefined) {
          return true;
        }
      }
      if (DNS_LIKE_MESSAGE_RE.test(reason)) {
        return true;
      }
    }
  }

  if (videoError) {
    const code = videoError.code;
    const msg = videoError.message ?? '';
    if ((code === 4 || code === 2) && DNS_LIKE_MESSAGE_RE.test(msg)) {
      return true;
    }
  }

  return false;
}

// Déclencheur global. Idempotent : dispatch plusieurs fois est safe, le
// banner gère lui-même le "1 fois par chargement".
// `switched` indique si on a réussi à basculer automatiquement sur un embed
// — le banner s'en sert pour afficher le message "on a changé de lecteur
// pour toi automatiquement" uniquement quand c'est vrai.
export function notifyDnsBlocked(
  detail: { host?: string; details?: string; switched?: boolean }
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('movix:dns-blocked', { detail }));
}
