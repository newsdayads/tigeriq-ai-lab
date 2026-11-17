package ai.tigeriq.ultracarhcm.v2

import android.app.ActivityOptions
import android.content.Context
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.view.Display
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android verifies launch OPTIONS, not OEM DeX freeform placement.
 * Test target MUST remain the isolated .vqa application package.
 */
@RunWith(AndroidJUnit4::class)
class V2ExternalAppFrameDeviceTest {
    private val app = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun assignedLauncherPackageIsVisibleOnAndroid11Plus() {
        assertEquals("ai.tigeriq.ultracarhcm.v2.vqa", app.packageName)
        // ADB verified YouTube is already installed on this authorized S10.
        assertNotNull(
            "Launcher package visibility missing for existing YouTube app",
            app.packageManager.getLaunchIntentForPackage("com.google.android.youtube"),
        )
    }

    @Test fun externalDisplayWindowRequestSerializesCorrectIdAndBounds() {
        assertEquals("ai.tigeriq.ultracarhcm.v2.vqa", app.packageName)
        val manager = app.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val secondary = manager.displays.firstOrNull {
            it.isValid && it.displayId != Display.DEFAULT_DISPLAY
        }
        assertNotNull("Requires explicit Android secondary-display test setup", secondary)
        val external = secondary!!
        val density = app.createDisplayContext(external).resources.displayMetrics.density
        val bounds = ExternalAppWindowBoundsRules.initial(
            external.mode.physicalWidth,
            external.mode.physicalHeight,
            density,
        )
        assertNotNull("External frame rules rejected actual Android display", bounds)
        val frame = bounds!!
        val request = ActivityOptions.makeBasic()
        request.launchDisplayId = external.displayId
        request.launchBounds = Rect(frame.left, frame.top, frame.right, frame.bottom)

        // Serializing real framework ActivityOptions proves the request can be
        // sent; only physical Samsung DeX can prove OEM honored it.
        val restored = ActivityOptions.fromBundle(request.toBundle())
        assertNotNull(restored)
        assertEquals(external.displayId, restored!!.launchDisplayId)
        assertEquals(Rect(frame.left, frame.top, frame.right, frame.bottom),
            restored.launchBounds)
        assertTrue(frame.left >= external.mode.physicalWidth / 3)
    }
}
