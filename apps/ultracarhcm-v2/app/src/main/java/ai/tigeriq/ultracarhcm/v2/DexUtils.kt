package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.util.Log
import android.view.Display

/** Display-type guard: Android developer overlays must NEVER be treated as real Samsung DeX. */
internal object DexDisplayTypeRules {
    fun eligibleExternal(
        displayId: Int,
        type: Int,
        valid: Boolean,
        on: Boolean,
        nativeDesktopActive: Boolean,
    ): Boolean =
        displayId != Display.DEFAULT_DISPLAY &&
            valid && on &&
            type != Display.TYPE_OVERLAY &&
            (type != Display.TYPE_VIRTUAL || nativeDesktopActive)
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
            // Not Samsung; use real external-display fallback only.
        } catch (_: SecurityException) {
            // OEM reflection unavailable: fail closed for virtual displays.
        }
        return false
    }

    private fun eligible(display: Display, nativeDesktop: Boolean): Boolean =
        DexDisplayTypeRules.eligibleExternal(
            displayId = display.displayId,
            type = display.type,
            valid = display.isValid,
            on = display.state == Display.STATE_ON,
            nativeDesktopActive = nativeDesktop,
        )

    fun isDesktop(context: Context): Boolean {
        val nativeDesktop = nativeDesktopActive(context)
        if (nativeDesktop) return true
        return (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
            ?.displays?.any { eligible(it, nativeDesktop) } == true
    }

    fun resolveDisplay(context: Context, activityDisplayId: Int): Display? {
        val manager =
            context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return null
        val nativeDesktop = nativeDesktopActive(context)
        val activityDisplay = manager.getDisplay(activityDisplayId)
        // Preserve a real active external DeX display but NEVER a simulated overlay.
        if (activityDisplay != null && eligible(activityDisplay, nativeDesktop)) {
            return activityDisplay
        }
        // Home may be on the phone while Samsung DeX owns the external display.
        // Refuse synthetic developer overlays or unrelated app virtual displays.
        val external = manager.displays.firstOrNull { eligible(it, nativeDesktop) }
        if (external != null) return external
        Log.i("UltraCarV2", "No verified DeX display: activity=$activityDisplayId")
        return null
    }
}
