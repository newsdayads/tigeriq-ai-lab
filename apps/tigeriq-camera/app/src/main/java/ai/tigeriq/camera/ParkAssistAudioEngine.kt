package ai.tigeriq.camera

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Automotive Ultrasonic Park Assist Sound Synthesizer.
 * Generates OEM sonar beeps matching vehicle distance zones:
 * - > 1.5m: Silent / Standby
 * - 1.0m .. 1.5m (Zone Green): Caution beeps (800ms interval)
 * - 0.5m .. 1.0m (Zone Yellow): Warning beeps (350ms interval)
 * - < 0.5m (Zone Red): Critical rapid alarm (120ms interval)
 */
class ParkAssistAudioEngine(private val settings: CameraSettings) {

    constructor(context: android.content.Context) : this(CameraSettings(context))

    companion object {
        private const val TAG = "ParkAssistAudio"
    }

    private val handler = Handler(Looper.getMainLooper())
    private var toneGenerator: ToneGenerator? = null
    private var isPlaying = false
    private var currentDistanceMeters = 1.2f // Default caution distance when reverse engaged

    private val beepRunnable = object : Runnable {
        override fun run() {
            if (!isPlaying || !settings.isParkAssistBeepEnabled) return

            val interval = when {
                currentDistanceMeters < 0.55f -> 140L  // Critical Red Zone: rapid warning
                currentDistanceMeters < 1.05f -> 360L  // Yellow Warning Zone: medium tempo
                currentDistanceMeters < 1.60f -> 800L  // Green Caution Zone: slow tempo
                else -> 2200L                          // Free Zone: very slow periodic check
            }

            val toneDuration = if (currentDistanceMeters < 0.55f) 50 else 70

            playTone(toneDuration)
            handler.postDelayed(this, interval)
        }
    }

    init {
        initToneGenerator()
    }

    private fun initToneGenerator() {
        try {
            toneGenerator = ToneGenerator(AudioManager.STREAM_MUSIC, 85)
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to initialize ToneGenerator", t)
        }
    }

    private fun playTone(durationMs: Int) {
        try {
            toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP2, durationMs)
        } catch (_: Throwable) {
            try {
                toneGenerator = ToneGenerator(AudioManager.STREAM_MUSIC, 85)
                toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, durationMs)
            } catch (_: Throwable) {}
        }
    }

    fun start() {
        if (!settings.isParkAssistBeepEnabled) return
        if (isPlaying) return
        isPlaying = true
        handler.removeCallbacks(beepRunnable)
        handler.post(beepRunnable)
    }

    fun stop() {
        isPlaying = false
        handler.removeCallbacks(beepRunnable)
        try {
            toneGenerator?.stopTone()
        } catch (_: Throwable) {}
    }

    fun setDistance(meters: Float) {
        currentDistanceMeters = meters.coerceIn(0.1f, 3.0f)
    }

    fun release() {
        stop()
        try {
            toneGenerator?.release()
        } catch (_: Throwable) {}
        toneGenerator = null
    }
}
