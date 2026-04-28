/**
 * Movix Android Cast bridge — minimal shim matching the API that the Movix
 * web app already expects when running inside the native Android WebView.
 *
 * The web side (see `src/components/HLSPlayer.tsx` around line 5253) detects
 * `window.MovixAndroidCast` and routes casts through it instead of the Google
 * cast_sender.js SDK (which doesn't function in a WebView). When the shim is
 * present, Movix's existing Cast buttons in each web player "just work" — the
 * UI is identical to the browser experience with a Chromecast detected.
 *
 * Shape expected by Movix:
 *   window.MovixAndroidCast = {
 *     isSupported(): Promise<boolean>,
 *     loadMedia(url, title, poster, currentTimeSec): Promise<void>,
 *     stop(): Promise<void>,
 *   }
 *
 * Movix also listens for these DOM events on window (dispatched by this shim
 * when the native side emits the corresponding CAST_SESSION_* events):
 *   CAST_SESSION_STARTED / CAST_SESSION_RESUMED — no detail
 *   CAST_SESSION_ENDED                           — no detail
 *   CAST_SESSION_FAILED                          — CustomEvent{detail:{error}}
 */

export function buildCastShim(): string {
  return `
(function() {
  if (window.__MOVIX_ANDROID_CAST_INSTALLED__) return;
  window.__MOVIX_ANDROID_CAST_INSTALLED__ = true;

  var pendingCallbacks = Object.create(null);
  var idCounter = 0;

  function nextId() {
    idCounter = (idCounter + 1) % 0x7fffffff;
    return 'mc' + Date.now().toString(36) + '_' + idCounter.toString(36);
  }

  function postNative(msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) {}
  }

  function callNative(type, payload) {
    return new Promise(function(resolve, reject) {
      var id = nextId();
      pendingCallbacks[id] = { resolve: resolve, reject: reject };
      var msg = { type: type, id: id };
      if (payload) {
        for (var k in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
        }
      }
      postNative(msg);
    });
  }

  window.MovixAndroidCast = {
    isSupported: function() {
      return callNative('CASTSHIM_INIT').then(function(payload) {
        return !!(payload && payload.supported);
      });
    },
    loadMedia: function(url, title, poster, currentTime) {
      return callNative('CASTSHIM_LOAD_MEDIA', {
        url: url || '',
        title: title || 'Movix',
        poster: poster || '',
        currentTime: (typeof currentTime === 'number' && currentTime >= 0) ? currentTime : 0,
      });
    },
    stop: function() {
      return callNative('CASTSHIM_STOP');
    },
  };

  window.addEventListener('__MOVIX_CAST_SHIM__', function(e) {
    var detail = e && e.detail;
    if (!detail) return;

    if (detail.kind === 'RESPONSE') {
      var cb = pendingCallbacks[detail.id];
      if (!cb) return;
      delete pendingCallbacks[detail.id];
      if (detail.ok) {
        cb.resolve(detail.payload || null);
      } else {
        var msg = (detail.error && (detail.error.message || detail.error.description)) || 'Cast error';
        cb.reject(new Error(msg));
      }
      return;
    }

    if (detail.kind === 'SESSION_EVENT') {
      switch (detail.event) {
        case 'STARTED':
          window.dispatchEvent(new CustomEvent('CAST_SESSION_STARTED', { detail: { deviceName: detail.deviceName || '' } }));
          break;
        case 'RESUMED':
          window.dispatchEvent(new CustomEvent('CAST_SESSION_RESUMED', { detail: { deviceName: detail.deviceName || '' } }));
          break;
        case 'ENDED':
          window.dispatchEvent(new CustomEvent('CAST_SESSION_ENDED'));
          break;
        case 'FAILED':
          window.dispatchEvent(new CustomEvent('CAST_SESSION_FAILED', { detail: { error: detail.error || 0 } }));
          break;
        case 'PICKER_DISMISSED':
          // No matching Movix listener; swallow.
          break;
      }
    }
  });
})();
true;
`;
}
