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
