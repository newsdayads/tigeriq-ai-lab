package ai.tigeriq.camera

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Dedicated, deterministic Reverse Gear (Số R) signal receiver.
 * Listens to all standard automotive and custom broadcast intents.
 */
class ReverseGearReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "TigerIQ_Reverse"
        const val ACTION_REVERSE_GEAR = "ai.tigeriq.camera.action.REVERSE_GEAR"

        // Source actions from original UltraCar AndroidManifest.xml.
        val REVERSE_ACTIONS = arrayOf(
            "com.tigeriq.dexsplit.ACTION_REVERSE_GEAR",
            "com.ultracar.dexsplit.ACTION_REVERSE_GEAR",
            "android.intent.action.REVERSE_GEAR",
            "com.car.REVERSE"
        )

        fun parseIsReverse(intent: Intent): Boolean? {
            // Direct port from original working UltraCar v1.0.17:
            // action contains "REVERSE", boolean "state", optional "gear" overrides state.
            return UltraCarReverseSignal.parse(
                intent.action,
                intent.getBooleanExtra("state", false),
                intent.getStringExtra("gear")
            )
        }
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val settings = CameraSettings(context)
        val action = intent.action ?: return
        CameraEventLog.record(context, "GEAR", "BROADCAST_RECEIVED", action +
            " | auto=" + settings.isReverseAutoStart)
        if (!settings.isReverseAutoStart) {
            CameraEventLog.record(context, "GEAR", "IGNORED", "reverse_autostart_disabled")
            return
        }
        Log.i(TAG, "Received gear signal broadcast: $action")

        val isReverse = parseIsReverse(intent) ?: run {
            CameraEventLog.record(context, "GEAR", "NOT_ULTRACAR_REVERSE", action)
            return
        }
        settings.recordReverseSignal(action, isReverse)
        CameraEventLog.record(context, "GEAR", if (isReverse) "R_ON" else "R_OFF",
            "source=broadcast | synthetic=" + (action == ACTION_REVERSE_GEAR))
        val steering = intent.getFloatExtra("steering", 0f)

        if (isReverse) {
            Log.i(TAG, "Reverse Gear ENGAGED (R=ON) -> Launching TigerIQ Camera immediately")
            val targetDisplay = DeXDisplayHelper.resolveTargetDisplay(context)
            val displayId = targetDisplay?.displayId ?: -1
            FloatingCameraService.gear(context, true)
        } else {
            Log.i(TAG, "Reverse Gear DISENGAGED (R=OFF) -> Auto-closing Camera immediately")
            FloatingCameraService.gear(context, false)
            CameraActivity.dismissIfRunning(immediate = true)
            try {
                context.sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
            } catch (_: Throwable) {}
        }
    }
}
