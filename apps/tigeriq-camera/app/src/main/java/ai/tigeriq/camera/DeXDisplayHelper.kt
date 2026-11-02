package ai.tigeriq.camera

import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.view.Display

object DeXDisplayHelper {

    /**
     * Checks if the device is currently running in Samsung DeX mode.
     */
    fun isDeXMode(context: Context): Boolean {
        val config = context.resources.configuration
        try {
            val field = config.javaClass.getField("semDesktopModeEnabled")
            val value = field.getInt(config)
            return value == 1
        } catch (_: Throwable) {
            // Fallback: check UI mode type desk
            return (config.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_DESK
        }
    }

    /**
     * Resolves the target display for camera presentation.
     * Prefers external display (DeX monitor / car screen) if connected, otherwise default display.
     */
    fun resolveTargetDisplay(context: Context, preferredDisplayId: Int = -1): Display? {
        val dm = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return null
        if (preferredDisplayId >= 0) {
            val explicit = dm.getDisplay(preferredDisplayId)
            if (explicit != null && explicit.isValid) return explicit
        }

        val displays = dm.displays
        // Find external presentation or non-default display
        val external = displays.firstOrNull { it.displayId != Display.DEFAULT_DISPLAY && it.isValid }
        return external ?: dm.getDisplay(Display.DEFAULT_DISPLAY)
    }
}
