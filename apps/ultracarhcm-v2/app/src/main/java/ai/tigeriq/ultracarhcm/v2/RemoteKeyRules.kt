package ai.tigeriq.ultracarhcm.v2

import android.view.KeyEvent

/**
 * V2's independent, fail-closed remote-key contract.
 *
 * Only replayable media/volume keys can be captured. System navigation, power,
 * call, back and home keys must never be intercepted.
 */
internal object RemoteKeyRules {
    const val PREFS = "v2_remote_key"
    const val ENABLED = "enabled"
    const val TARGET_KEY = "target_key_code"
    const val HOLD_MS = "hold_ms"

    const val DEFAULT_HOLD_MS = 500L
    const val MIN_HOLD_MS = 300L
    const val MAX_HOLD_MS = 1800L
    const val MAX_PRESS_MS = 5000L

    val allowedKeys: List<Int> = listOf(
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_STOP,
        KeyEvent.KEYCODE_HEADSETHOOK,
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_VOLUME_MUTE,
    )

    fun safeToMap(keyCode: Int): Boolean = keyCode in allowedKeys

    fun holdDuration(configured: Long): Long =
        configured.coerceIn(MIN_HOLD_MS, MAX_HOLD_MS)

    fun longPress(elapsedMs: Long, configuredHoldMs: Long): Boolean =
        elapsedMs >= holdDuration(configuredHoldMs) && elapsedMs < MAX_PRESS_MS

    fun keyLabel(keyCode: Int): String = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "Play / Pause"
        KeyEvent.KEYCODE_MEDIA_NEXT -> "Next"
        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "Previous"
        KeyEvent.KEYCODE_MEDIA_PLAY -> "Play"
        KeyEvent.KEYCODE_MEDIA_PAUSE -> "Pause"
        KeyEvent.KEYCODE_MEDIA_STOP -> "Stop"
        KeyEvent.KEYCODE_HEADSETHOOK -> "Headset"
        KeyEvent.KEYCODE_VOLUME_UP -> "Volume +"
        KeyEvent.KEYCODE_VOLUME_DOWN -> "Volume -"
        KeyEvent.KEYCODE_VOLUME_MUTE -> "Mute"
        else -> "Unmapped"
    }
}
