package com.movix.app.cast

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.mediarouter.app.MediaRouteChooserDialog
import androidx.mediarouter.media.MediaRouteSelector
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.images.WebImage

/**
 * Pont Google Cast exposé à React Native / WebView.
 *
 * Méthodes:
 * - isSupported(): les Play Services Cast sont-ils dispo sur l'appareil ?
 * - showPicker(): affiche le sélecteur d'appareils (MediaRouteChooserDialog).
 * - loadMedia(url, title, poster, currentTimeSec): charge un média ; ouvre le picker si pas de session.
 * - stop(): termine la session cast en cours.
 *
 * Événements (via RCTDeviceEventEmitter):
 * - CAST_SESSION_STARTED / CAST_SESSION_RESUMED / CAST_SESSION_ENDED / CAST_SESSION_FAILED
 */
class CastModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var castContext: CastContext? = null
    private var pendingLoad: LoadRequest? = null
    private var listenerRegistered = false

    private data class LoadRequest(
        val url: String,
        val title: String,
        val poster: String?,
        val currentTimeSec: Double,
    )

    private val sessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarted(session: CastSession, sessionId: String) {
            val params = Arguments.createMap().apply {
                putString("deviceName", session.castDevice?.friendlyName ?: "")
                putDouble(
                    "durationSec",
                    (session.remoteMediaClient?.mediaInfo?.streamDuration ?: 0L) / 1000.0,
                )
            }
            emit("CAST_SESSION_STARTED", params)
            pendingLoad?.let { req ->
                pendingLoad = null
                playMedia(session, req)
            }
        }

        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            val params = Arguments.createMap().apply {
                putString("deviceName", session.castDevice?.friendlyName ?: "")
                putDouble(
                    "durationSec",
                    (session.remoteMediaClient?.mediaInfo?.streamDuration ?: 0L) / 1000.0,
                )
            }
            emit("CAST_SESSION_RESUMED", params)
            pendingLoad?.let { req ->
                pendingLoad = null
                playMedia(session, req)
            }
        }

        override fun onSessionEnded(session: CastSession, error: Int) {
            pendingLoad = null
            val params = Arguments.createMap().apply { putInt("error", error) }
            emit("CAST_SESSION_ENDED", params)
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            pendingLoad = null
            val params = Arguments.createMap().apply { putInt("error", error) }
            emit("CAST_SESSION_FAILED", params)
        }

        override fun onSessionSuspended(session: CastSession, reason: Int) {}
        override fun onSessionStarting(session: CastSession) {}
        override fun onSessionEnding(session: CastSession) {}
        override fun onSessionResuming(session: CastSession, sessionId: String) {}
        override fun onSessionResumeFailed(session: CastSession, error: Int) {}
    }

    override fun getName(): String = "CastModule"

    override fun initialize() {
        super.initialize()
        reactContext.runOnUiQueueThread { ensureContext() }
    }

    override fun invalidate() {
        reactContext.runOnUiQueueThread {
            if (listenerRegistered) {
                castContext?.sessionManager
                    ?.removeSessionManagerListener(sessionListener, CastSession::class.java)
                listenerRegistered = false
            }
        }
        super.invalidate()
    }

    private fun ensureContext(): CastContext? {
        castContext?.let { return it }

        val activity = currentActivity ?: return null
        val gms = GoogleApiAvailability.getInstance()
        if (gms.isGooglePlayServicesAvailable(activity) != ConnectionResult.SUCCESS) {
            return null
        }

        return try {
            val ctx = CastContext.getSharedInstance(activity)
            if (!listenerRegistered) {
                ctx.sessionManager.addSessionManagerListener(
                    sessionListener,
                    CastSession::class.java,
                )
                listenerRegistered = true
            }
            castContext = ctx
            ctx
        } catch (_: Exception) {
            null
        }
    }

    @ReactMethod
    fun isSupported(promise: Promise) {
        reactContext.runOnUiQueueThread {
            val gms = GoogleApiAvailability.getInstance()
            val available = gms.isGooglePlayServicesAvailable(reactContext) == ConnectionResult.SUCCESS
            promise.resolve(available)
        }
    }

    @ReactMethod
    fun showPicker(promise: Promise) {
        reactContext.runOnUiQueueThread {
            val activity = currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No foreground activity")
                return@runOnUiQueueThread
            }
            if (ensureContext() == null) {
                promise.reject("CAST_UNAVAILABLE", "Google Cast not available on this device")
                return@runOnUiQueueThread
            }

            try {
                val selector = buildRouteSelector()
                val dialog = MediaRouteChooserDialog(activity)
                dialog.routeSelector = selector
                dialog.show()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("PICKER_ERROR", e.message ?: "Failed to show picker")
            }
        }
    }

    @ReactMethod
    fun loadMedia(
        url: String,
        title: String,
        poster: String?,
        currentTimeSec: Double,
        promise: Promise,
    ) {
        reactContext.runOnUiQueueThread {
            // Cast Default Media Receiver only accepts http(s). Reject other schemes
            // at the native boundary even though the JS layer filters 'blob:'.
            val scheme = url.substringBefore(":", "").lowercase()
            if (scheme != "http" && scheme != "https") {
                promise.reject("INVALID_URL", "Only http(s) URLs are castable")
                return@runOnUiQueueThread
            }

            val ctx = ensureContext()
            if (ctx == null) {
                promise.reject("CAST_UNAVAILABLE", "Google Cast not available on this device")
                return@runOnUiQueueThread
            }

            val req = LoadRequest(url, title, poster, currentTimeSec)
            val session = ctx.sessionManager.currentCastSession
            if (session != null && session.isConnected) {
                playMedia(session, req)
                promise.resolve(true)
                return@runOnUiQueueThread
            }

            val activity = currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No foreground activity")
                return@runOnUiQueueThread
            }

            // Pas de session active : mémoriser la requête, ouvrir le picker.
            // onSessionStarted() jouera le média une fois l'appareil sélectionné.
            pendingLoad = req
            try {
                val dialog = MediaRouteChooserDialog(activity)
                dialog.routeSelector = buildRouteSelector()
                dialog.setOnDismissListener {
                    // Delay briefly so onSessionStarting can fire if the user actually
                    // selected a device (dismiss happens synchronously before the
                    // Cast framework sets isConnecting=true).
                    Handler(Looper.getMainLooper()).postDelayed({
                        val current = ctx.sessionManager.currentCastSession
                        val sessionActive = current != null &&
                            (current.isConnected || current.isConnecting)
                        if (!sessionActive) {
                            pendingLoad = null
                            emit("CAST_PICKER_DISMISSED", null)
                        }
                    }, 500)
                }
                dialog.show()
                promise.resolve(true)
            } catch (e: Exception) {
                pendingLoad = null
                promise.reject("PICKER_ERROR", e.message ?: "Failed to show picker")
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                castContext?.sessionManager?.endCurrentSession(true)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STOP_ERROR", e.message ?: "Failed to stop cast")
            }
        }
    }

    @ReactMethod
    fun getCurrentDeviceName(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val session = castContext?.sessionManager?.currentCastSession
                promise.resolve(session?.castDevice?.friendlyName)
            } catch (e: Exception) {
                promise.reject("DEVICE_NAME_ERROR", e.message ?: "unknown", e)
            }
        }
    }

    @ReactMethod
    fun getCurrentPositionSec(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val client = castContext?.sessionManager?.currentCastSession?.remoteMediaClient
                val pos = client?.approximateStreamPosition ?: 0L
                promise.resolve(pos / 1000.0)
            } catch (e: Exception) {
                promise.reject("POSITION_ERROR", e.message ?: "unknown", e)
            }
        }
    }

    @ReactMethod
    fun getSessionState(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val session = castContext?.sessionManager?.currentCastSession
                val state = when {
                    session == null -> "idle"
                    session.isConnecting -> "starting"
                    session.isConnected -> "connected"
                    session.isDisconnecting -> "ending"
                    else -> "idle"
                }
                promise.resolve(state)
            } catch (e: Exception) {
                promise.reject("STATE_ERROR", e.message ?: "unknown", e)
            }
        }
    }

    // React Native exige ces deux no-ops quand on émet des events via NativeEventEmitter.
    @ReactMethod
    fun addListener(eventName: String) {
        // no-op; DeviceEventEmitter gère l'abonnement côté JS
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // no-op
    }

    private fun buildRouteSelector(): MediaRouteSelector {
        return MediaRouteSelector.Builder()
            .addControlCategory(
                CastMediaControlIntent.categoryForCast(
                    CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID,
                ),
            )
            .build()
    }

    private fun playMedia(session: CastSession, req: LoadRequest) {
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, req.title)
            req.poster?.takeIf { it.isNotBlank() }?.let { url ->
                try {
                    addImage(WebImage(Uri.parse(url)))
                } catch (_: Exception) {
                    // Image optionnelle, on ignore une URL invalide
                }
            }
        }

        val contentType = when {
            req.url.contains(".m3u8", ignoreCase = true) -> "application/x-mpegURL"
            req.url.contains(".mp4", ignoreCase = true) -> "video/mp4"
            else -> "application/x-mpegURL"
        }

        val mediaInfo = MediaInfo.Builder(req.url)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(contentType)
            .setMetadata(metadata)
            .build()

        val loadReq = MediaLoadRequestData.Builder()
            .setMediaInfo(mediaInfo)
            .setAutoplay(true)
            .setCurrentTime((req.currentTimeSec * 1000).toLong().coerceAtLeast(0L))
            .build()

        session.remoteMediaClient?.load(loadReq)
    }

    private fun emit(name: String, params: WritableMap?) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(name, params)
        } catch (_: Exception) {
            // Catalyst inactif pendant le teardown : on ignore
        }
    }
}
