package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.View
import android.view.ViewGroup
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android 12 developer "Simulate secondary displays" only.
 * Requires a temporary 1600x900/240 or 1920x1080/320 overlay, created and
 * reverted by the external QA harness. NOT physical Samsung DeX or UVC.
 */
@RunWith(AndroidJUnit4::class)
class V2VirtualSecondaryDisplayTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val target get() = instrumentation.targetContext

    private fun simulatedOverlay(): Display {
        val manager = target.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val overlay = manager.displays.singleOrNull {
            it.type == Display.TYPE_OVERLAY && it.displayId != Display.DEFAULT_DISPLAY && it.isValid
        }
        assertNotNull("No developer virtual display configured for this test", overlay)
        return overlay!!
    }

    @Test fun virtualDisplayMustNotTriggerProductionDexOverlay() {
        val secondary = simulatedOverlay()
        assertEquals(Display.TYPE_OVERLAY, secondary.type)
        assertFalse("Simulated display must not be identified as real DeX", DexUtils.isDesktop(target))
        assertNull("Fake DeX display must not host floating Camera bar",
            DexUtils.resolveDisplay(target, Display.DEFAULT_DISPLAY))
        assertNull("Virtual display must not be accepted as real DeX",
            DexUtils.resolveDisplay(target, secondary.displayId))
    }

    @Test fun cameraPopupGeometryUsesVirtualDisplayDensityAndFitsWithinItsScreen() {
        val secondary = simulatedOverlay()
        val mode = secondary.mode
        val context = target.createDisplayContext(secondary)
        val density = context.resources.displayMetrics.density
        assertTrue("Secondary resolution too small", mode.physicalWidth >= 1280)
        assertTrue("Secondary density invalid", density.isFinite() && density > 0)
        val bounds = CameraWindowBoundsRules.initial(
            mode.physicalWidth,
            mode.physicalHeight,
            density,
        )
        assertNotNull("Failed to compute Camera window bounds", bounds)
        assertTrue(bounds!!.left >= 0)
        assertTrue(bounds.top >= 0)
        assertTrue(bounds.right <= mode.physicalWidth)
        assertTrue(bounds.bottom <= mode.physicalHeight)
        assertTrue(bounds.width >= 320)
        assertTrue(bounds.height >= 200)
    }

    @Test fun virtualDisplayPopupShortcutNeverEscapesToDefaultScreenOnExplicitTarget() {
        val secondary = simulatedOverlay()
        assertFalse(CameraDisplayRules.shouldToggleExisting(
            Display.DEFAULT_DISPLAY, secondary.displayId))
        assertTrue(CameraDisplayRules.needsDedicatedTask(
            Display.DEFAULT_DISPLAY, secondary.displayId))
        assertFalse(CameraDisplayRules.allowUnspecifiedFallback(secondary.displayId))
    }

    @Test fun homeActivityActuallyLaunchesOnSimulatedSecondaryDisplay() {
        val secondary = simulatedOverlay()
        val displayContext = target.createDisplayContext(secondary)
        val intent = Intent(displayContext, HomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
        val monitor = instrumentation.addMonitor(HomeActivity::class.java.name, null, false)
        var launched: Activity? = null
        try {
            val opts = ActivityOptions.makeBasic().apply {
                launchDisplayId = secondary.displayId
            }
            displayContext.startActivity(intent, opts.toBundle())
            launched = instrumentation.waitForMonitorWithTimeout(monitor, 9000)
            assertNotNull("Android refused secondary-display Home launch", launched)
            instrumentation.waitForIdleSync()
            val activity = launched!!
            val actual = activity.window.decorView.display?.displayId
            assertEquals("Home rendered on wrong display", secondary.displayId, actual)
            val content = activity.findViewById<View>(android.R.id.content)
            assertNotNull("No Home view on the secondary display", content)
            assertTrue("Home has zero measured width", content.width > 500)
            assertTrue("Home has zero measured height", content.height > 350)
            assertFalse("Real Samsung DeX must not be synthesized", DexUtils.isDesktop(activity))
        } finally {
            launched?.let { activity ->
                instrumentation.runOnMainSync { activity.finish() }
                instrumentation.waitForIdleSync()
            }
            instrumentation.removeMonitor(monitor)
        }
    }
}
