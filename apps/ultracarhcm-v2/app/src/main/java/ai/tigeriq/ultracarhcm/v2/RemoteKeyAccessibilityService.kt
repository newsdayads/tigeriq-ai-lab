package ai.tigeriq.ultracarhcm.v2

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * User-enabled Bluetooth steering-wheel key capture, scoped to media/volume
 * controls. Short press retains the original media/volume action; holding opens
 * or closes the real USB camera window.
 *
 * Never turns on Accessibility without the system settings UI. Never acts on
 * gear broadcasts, unverified physical input, or privileged key injection.
 */
class RemoteKeyAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile private var connected: RemoteKeyAccessibilityService? = null

        fun connectedNow(): Boolean = connected != null

        fun learnNext(callback: (Int) -> Unit): Boolean {
            val running = connected ?: return false
            running.pendingLearn = callback
            running.clearPress()
            return true
        }

        fun cancelLearn() {
            connected?.pendingLearn = null
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var pendingLearn: ((Int) -> Unit)? = null
    private var consumeLearnRelease = -1
    private var pressCode = -1
    private var pressStartedAt = 0L
    private var pressTriggered = false
    private var pressGeneration = 0
    private var holdTask: Runnable? = null
    private var replayCode = -1
    private var replayRemaining = 0
    private var replayExpiresAt = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        val current = serviceInfo
        current.flags = current.flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        serviceInfo = current
        connected = this
        Log.i("UltraCarV2Remote", "Accessibility connected; user control required")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() {
        clearPress()
        pendingLearn = null
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        clearPress()
        pendingLearn = null
        if (connected === this) connected = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        clearPress()
        pendingLearn = null
        if (connected === this) connected = null
        super.onDestroy()
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        val now = SystemClock.uptimeMillis()

        // Replayed short media presses must not trigger another long-press cycle.
        if (keyCode == replayCode && replayRemaining > 0 && now <= replayExpiresAt) {
            replayRemaining--
            if (replayRemaining == 0) replayCode = -1
            return false
        }

        if (keyCode == consumeLearnRelease && event.action == KeyEvent.ACTION_UP) {
            consumeLearnRelease = -1
            return true
        }

        if (event.isCanceled) {
            if (pressCode == keyCode) clearPress()
            return false
        }

        val learner = pendingLearn
        if (learner != null && RemoteKeyRules.safeToMap(keyCode)) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                pendingLearn = null
                consumeLearnRelease = keyCode
                handler.post { learner(keyCode) }
                return true
            }
            return true
        }

        val settings = getSharedPreferences(RemoteKeyRules.PREFS, Context.MODE_PRIVATE)
        val assigned = settings.getInt(
            RemoteKeyRules.TARGET_KEY,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        )
        if (!settings.getBoolean(RemoteKeyRules.ENABLED, false) ||
            !RemoteKeyRules.safeToMap(assigned) || assigned != keyCode
        ) {
            return false
        }

        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount != 0 || pressCode == keyCode) return true
                clearPress()
                pressCode = keyCode
                pressStartedAt = now
                val generation = ++pressGeneration
                val holdMs = RemoteKeyRules.holdDuration(
                    settings.getLong(RemoteKeyRules.HOLD_MS, RemoteKeyRules.DEFAULT_HOLD_MS),
                )
                val task = Runnable {
                    if (pressGeneration == generation && pressCode == keyCode && !pressTriggered) {
                        pressTriggered = true
                        toggleRealCamera()
                    }
                }
                holdTask = task
                handler.postDelayed(task, holdMs)
                return true
            }
            KeyEvent.ACTION_UP -> {
                if (pressCode != keyCode) return true
                val elapsed = (now - pressStartedAt).coerceAtLeast(0L)
                val triggered = pressTriggered ||
                    RemoteKeyRules.longPress(
                        elapsed,
                        settings.getLong(RemoteKeyRules.HOLD_MS, RemoteKeyRules.DEFAULT_HOLD_MS),
                    )
                clearPress()
                if (triggered) {
                    if (!pressTriggered && elapsed < RemoteKeyRules.MAX_PRESS_MS) {
                        toggleRealCamera()
                    }
                } else {
                    replayShortKey(keyCode)
                }
                return true
            }
        }
        return false
    }

    private fun clearPress() {
        holdTask?.let { handler.removeCallbacks(it) }
        holdTask = null
        pressCode = -1
        pressStartedAt = 0L
        pressTriggered = false
        pressGeneration++
    }

    private fun toggleRealCamera() {
        val requestedDisplay =
            DexUtils.resolveDisplay(this, Display.DEFAULT_DISPLAY)?.displayId
                ?: Display.DEFAULT_DISPLAY
        // Explicit in-app camera route; not a fake camera/frame and not gear-R.
        try {
            UsbCameraActivity.toggleFromShortcut(this, requestedDisplay)
        } catch (error: RuntimeException) {
            Log.e("UltraCarV2Remote", "Camera cannot be launched from Accessibility", error)
        }
    }

    private fun replayShortKey(keyCode: Int) {
        if (!RemoteKeyRules.safeToMap(keyCode)) return
        val audio = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        try {
            when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP ->
                    audio.adjustSuggestedStreamVolume(1, AudioManager.USE_DEFAULT_STREAM_TYPE, AudioManager.FLAG_SHOW_UI)
                KeyEvent.KEYCODE_VOLUME_DOWN ->
                    audio.adjustSuggestedStreamVolume(-1, AudioManager.USE_DEFAULT_STREAM_TYPE, AudioManager.FLAG_SHOW_UI)
                KeyEvent.KEYCODE_VOLUME_MUTE ->
                    audio.adjustSuggestedStreamVolume(AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.USE_DEFAULT_STREAM_TYPE, AudioManager.FLAG_SHOW_UI)
                else -> {
                    // Synthetic bypass is deliberately bounded to the two replay events.
                    replayCode = keyCode
                    replayRemaining = 2
                    replayExpiresAt = SystemClock.uptimeMillis() + 1000L
                    val time = SystemClock.uptimeMillis()
                    audio.dispatchMediaKeyEvent(KeyEvent(time, time, KeyEvent.ACTION_DOWN, keyCode, 0))
                    audio.dispatchMediaKeyEvent(KeyEvent(time, time, KeyEvent.ACTION_UP, keyCode, 0))
                }
            }
        } catch (error: RuntimeException) {
            Log.e("UltraCarV2Remote", "Failed to replay short media/volume press", error)
        }
    }
}
