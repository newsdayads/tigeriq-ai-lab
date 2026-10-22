package ai.tigeriq.ultracarhcm.v2

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.util.Log
import android.view.Display

object DexUtils {
    fun isDesktop(context: Context): Boolean {
        if (context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_DESK) return true
        try {
            val c = context.resources.configuration
            val field = c.javaClass.getField("semDesktopModeEnabled")
            val on = c.javaClass.getField("SEM_DESKTOP_MODE_ENABLED").getInt(null)
            if (field.getInt(c) == on) return true
        } catch (_: Throwable) { }
        return (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
            ?.displays?.any { it.displayId != Display.DEFAULT_DISPLAY && it.isValid } == true
    }

    fun resolveDisplay(context: Context, activityDisplayId: Int): Display? {
        val manager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return null
        val activityDisplay = manager.getDisplay(activityDisplayId)
        // External activity already running on its DeX display: preserve that display.
        if (activityDisplayId != Display.DEFAULT_DISPLAY &&
            activityDisplay?.isValid == true && activityDisplay.state == Display.STATE_ON) return activityDisplay
        // Home may be on the phone display while DeX uses an external monitor.
        // Never attach camera shortcut to display 0 just because DeX is active.
        val external = manager.displays.firstOrNull {
            it.displayId != Display.DEFAULT_DISPLAY && it.isValid && it.state == Display.STATE_ON
        }
        if (external != null) return external
        Log.i("UltraCarV2", "No DeX display: activity=$activityDisplayId")
        return null
    }
}
