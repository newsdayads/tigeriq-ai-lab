package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.util.Log
import android.view.Display

/**
 * Android's Display.getType()/TYPE_OVERLAY are hidden APIs on our compile SDK.
 * A second display by itself therefore cannot be sufficient DeX evidence.
 */
internal object DexDisplayGateRules {
    fun eligibleExternal(
        displayId: Int,
        valid: Boolean,
        on: Boolean,
        nativeDesktopActive: Boolean,
    ): Boolean =
        nativeDesktopActive &&
            displayId != Display.DEFAULT_DISPLAY &&
            valid && on
}

object DexUtils {
    private fun nativeDesktopActive(context: Context): Boolean {
        val config = context.resources.configuration
        if (config.uiMode and Configuration.UI_MODE_TYPE_MASK ==
            Configuration.UI_MODE_TYPE_DESK
        ) return true
        try {
            val field = config.javaClass.getField("semDesktopModeEnabled")
            val on = config.javaClass.getField("SEM_DESKTOP_MODE_ENABLED").getInt(null)
            if (field.getInt(config) == on) return true
        } catch (_: ReflectiveOperationException) {
            // Not Samsung or OEM field unavailable. Do not guess DeX by display count.
        } catch (_: SecurityException) {
            // Hidden OEM state blocked; fail closed rather than infer DeX.
        }
        return false
    }

    private fun eligible(display: Display, nativeDesktop: Boolean): Boolean =
        DexDisplayGateRules.eligibleExternal(
            displayId = display.displayId,
            valid = display.isValid,
            on = display.state == Display.STATE_ON,
            nativeDesktopActive = nativeDesktop,
        )

    fun isDesktop(context: Context): Boolean = nativeDesktopActive(context)

    fun resolveDisplay(context: Context, activityDisplayId: Int): Display? {
        val manager =
            context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return null
        val nativeDesktop = nativeDesktopActive(context)
        if (!nativeDesktop) {
            Log.i("UltraCarV2", "No verified native DeX mode: activity=$activityDisplayId")
            return null
        }
        val activityDisplay = manager.getDisplay(activityDisplayId)
        if (activityDisplay != null && eligible(activityDisplay, nativeDesktop)) {
            return activityDisplay
        }
        val external = manager.displays.firstOrNull { eligible(it, nativeDesktop) }
        if (external != null) return external
        Log.i("UltraCarV2", "No active external DeX display: activity=$activityDisplayId")
        return null
    }
}
