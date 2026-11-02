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

        val REVERSE_ACTIONS = arrayOf(
            ACTION_REVERSE_GEAR,
            "com.tigeriq.dexsplit.ACTION_REVERSE_GEAR",
            "com.ultracar.dexsplit.ACTION_REVERSE_GEAR",
            "android.intent.action.REVERSE_GEAR",
            "com.car.REVERSE",
            "com.ultracar.dexsplit.REVERSE",
            "com.android.car.GEAR_CHANGE",
            "android.hardware.reverse.state",
            "com.samsung.android.car.GEAR_CHANGED",
            "com.car.GEAR_CHANGED",
            "com.mct.action.REVERSE",
            "com.microntek.action.REVERSE",
            "com.ts.action.REVERSE",
            "com.syu.action.REVERSE",
            "com.xyauto.REVERSE"
        )

        fun parseIsReverse(intent: Intent): Boolean {
            val action = intent.action ?: ""

            // 1. Check explicit string extras
            val gearKeys = arrayOf("gear", "GEAR", "current_gear", "gear_state", "gear_name", "gearName", "new_gear")
            for (key in gearKeys) {
                val str = try { intent.getStringExtra(key) } catch (_: ClassCastException) { null }
                if (!str.isNullOrEmpty()) {
                    if (str.equals("R", ignoreCase = true) || str.contains("REVERSE", ignoreCase = true)) {
                        return true
                    }
                    if (str.equals("P", ignoreCase = true) || str.equals("D", ignoreCase = true) || str.equals("N", ignoreCase = true)) {
                        return false
                    }
                }
            }

            // 2. Check explicit int extras (CarGear.GEAR_REVERSE = 8, 2, etc.)
            for (key in gearKeys) {
                if (intent.hasExtra(key)) {
                    val intVal = try { intent.getIntExtra(key, -1) } catch (_: ClassCastException) { -1 }
                    if (intVal == 8 || intVal == 2 || intVal == 'R'.code || intVal == 'r'.code) {
                        return true
                    }
                    if (intVal == 4 || intVal == 1 || intVal == 0 || intVal == 'P'.code || intVal == 'p'.code) {
                        return false
                    }
                }
            }

            // 3. Check explicit boolean extras
            val boolKeys = arrayOf("reverse", "isReverse", "is_reverse", "state", "r_state", "reverse_state", "active")
            for (key in boolKeys) {
                if (intent.hasExtra(key)) {
                    return try {
                        intent.getBooleanExtra(key, false)
                    } catch (_: Throwable) {
                        try { intent.getIntExtra(key, 0) == 1 } catch (_: ClassCastException) { false }
                    }
                }
            }

            // 4. Fallback on action name
            if (action.contains("REVERSE", ignoreCase = true)) {
                return true
            }

            return false
        }
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val settings = CameraSettings(context)
        if (!settings.isReverseAutoStart) {
            Log.i(TAG, "Reverse auto-start is disabled in settings")
            return
        }

        val action = intent.action ?: return
        Log.i(TAG, "Received gear signal broadcast: $action")

        val isReverse = parseIsReverse(intent)
        settings.recordReverseSignal(action, isReverse)
        val steering = intent.getFloatExtra("steering", 0f)

        if (isReverse) {
            Log.i(TAG, "Reverse Gear ENGAGED (R=ON) -> Launching TigerIQ Camera immediately")
            val targetDisplay = DeXDisplayHelper.resolveTargetDisplay(context)
            val displayId = targetDisplay?.displayId ?: -1
            CameraActivity.launch(
                context = context,
                displayId = displayId,
                reverseActive = true,
                steering = steering
            )
        } else {
            Log.i(TAG, "Reverse Gear DISENGAGED (R=OFF) -> Auto-closing Camera immediately")
            CameraActivity.dismissIfRunning(immediate = true)
            try {
                context.sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
            } catch (_: Throwable) {}
        }
    }
}
