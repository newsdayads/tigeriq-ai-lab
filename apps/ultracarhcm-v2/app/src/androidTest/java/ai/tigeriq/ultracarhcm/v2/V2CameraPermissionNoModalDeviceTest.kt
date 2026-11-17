package ai.tigeriq.ultracarhcm.v2

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real Android S10 regression: opening a camera frame must not silently
 * trigger a system CAMERA permission popup. Only pressing CAM may request it.
 * Does not grant any permission, connect UVC, or alter V1/user V2.
 */
@RunWith(AndroidJUnit4::class)
class V2CameraPermissionNoModalDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app = instrumentation.targetContext

    private fun allViews(root: View): List<View> {
        val views = mutableListOf<View>()
        fun walk(v: View) {
            views.add(v)
            if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
        }
        walk(root)
        return views
    }

    @Test fun f04RealHomeCameraButtonLaunchesOnItsActualAndroidDisplay() {
        assertEquals("ai.tigeriq.ultracarhcm.v2.vqa", app.packageName)
        assumeTrue(
            "Unattended QA must not grant a real CAMERA permission",
            app.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_DENIED,
        )
        val monitor = android.app.Instrumentation.ActivityMonitor(
            UsbCameraActivity::class.java.name, null, false,
        )
        instrumentation.addMonitor(monitor)
        var home: Activity? = null
        var camera: Activity? = null
        try {
            home = instrumentation.startActivitySync(
                Intent(app, HomeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK),
            )
            instrumentation.waitForIdleSync()
            val buttons = allViews(home!!.findViewById(android.R.id.content))
                .filterIsInstance<TextView>()
            val cameraButton = buttons.firstOrNull {
                it.isClickable && (it.contentDescription == "CAMERA" ||
                    it.contentDescription == "CAMERA USB")
            }
            assertNotNull("F04 must expose an actual clickable HOME Camera action", cameraButton)
            instrumentation.runOnMainSync {
                assertTrue("F04 Camera button must handle the real click",
                    cameraButton!!.performClick())
            }
            camera = instrumentation.waitForMonitorWithTimeout(monitor, 7000L)
            assertNotNull("F04 HOME Camera click did not open UsbCameraActivity", camera)
            instrumentation.waitForIdleSync()
            assertEquals(
                "F04 Camera popup launched on a different Android display",
                home!!.window.decorView.display?.displayId,
                camera!!.window.decorView.display?.displayId,
            )
            val text = allViews(camera!!.findViewById(android.R.id.content))
                .filterIsInstance<TextView>()
            assertTrue(
                "F04 missing fail-visible no-grant Camera status after HOME click",
                text.any { it.text.toString().contains("Chạm CAM để cấp quyền CAMERA") },
            )
        } finally {
            if (camera != null) {
                val closingCamera = camera
                instrumentation.runOnMainSync { closingCamera?.finish() }
            }
            if (home != null) {
                val closingHome = home
                instrumentation.runOnMainSync { closingHome?.finish() }
            }
            instrumentation.waitForIdleSync()
            instrumentation.removeMonitor(monitor)
        }
    }

    @Test fun f03CameraNoSurprisePermissionPopupUntilExplicitCamTap() {
        assertEquals("ai.tigeriq.ultracarhcm.v2.vqa", app.packageName)
        assumeTrue(
            "Permission already granted: cannot exercise denied first-entry path",
            app.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_DENIED,
        )
        val activity: Activity = instrumentation.startActivitySync(
            Intent(app, UsbCameraActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK),
        )
        try {
            instrumentation.waitForIdleSync()
            assertEquals(UsbCameraActivity::class.java, activity.javaClass)
            val views = allViews(activity.findViewById(android.R.id.content))
            assertTrue(
                "Camera must show a clear prompt to tap CAM, not auto-request permission",
                views.filterIsInstance<TextView>().any {
                    it.text.toString().contains("Chạm CAM để cấp quyền CAMERA")
                },
            )
            assertTrue(
                "CAM must remain available to explicitly request Android permission",
                views.filterIsInstance<Button>().any {
                    it.contentDescription == "MỞ CAMERA USB" && it.isEnabled
                },
            )
            assertFalse(
                "Camera must not be awaiting an unsolicited permission dialog",
                views.filterIsInstance<Button>().any {
                    it.contentDescription == "ĐANG CHỜ QUYỀN CAMERA"
                },
            )
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.waitForIdleSync()
        }
    }
}
