package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * GH-5135 F01-F22: real-device smoke for every declared V2 activity.
 *
 * Tests only the isolated QA applicationId suffix (.vqa), not an installed
 * user/production V2 or V1. No USB device attach, GPS grant, Bluetooth pair,
 * account setup, activation or reverse-gear simulation.
 * The generated captures prove a non-flat Android screen, NOT full V1 parity.
 */
@RunWith(AndroidJUnit4::class)
class V2AllScreenAuditDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val target = instrumentation.targetContext

    private fun inspect(name: String, screen: Class<out Activity>) {
        assertTrue(
            "Screen audit must never mutate production package",
            target.packageName.endsWith(".vqa"),
        )
        val intent = Intent(target, screen)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
        val activity = instrumentation.startActivitySync(intent)
        assertEquals("Unexpected launched Activity", screen, activity.javaClass)
        try {
            instrumentation.waitForIdleSync()
            val root = activity.findViewById<View>(android.R.id.content)
            assertNotNull("$name returned no Android content", root)
            assertTrue("$name content width is empty", root.width > 200)
            assertTrue("$name content height is empty", root.height > 300)
            val scale = minOf(1.0f, 960f / root.width.toFloat(), 900f / root.height.toFloat())
            val outWidth = (root.width * scale).toInt().coerceAtLeast(1)
            val outHeight = (root.height * scale).toInt().coerceAtLeast(1)
            val image = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888)
            try {
                instrumentation.runOnMainSync {
                    val canvas = Canvas(image)
                    canvas.scale(scale, scale)
                    root.draw(canvas)
                }
                var sampleCount = 0
                val colors = HashSet<Int>()
                var y = 0
                while (y < outHeight) {
                    var x = 0
                    while (x < outWidth) {
                        colors.add(image.getPixel(x, y))
                        sampleCount++
                        x += 23
                    }
                    y += 23
                }
                assertTrue("$name was rendered flat/blank; sampled $sampleCount pixels",
                    colors.size >= 4)
                val directory = File(target.getExternalFilesDir(null), "gh5135-screen-audit")
                assertTrue("Cannot create private QA screenshot directory",
                    directory.isDirectory || directory.mkdirs())
                val output = File(directory, "v2_" + name + ".png")
                output.outputStream().use { stream ->
                    assertTrue("$name PNG encoding failed",
                        image.compress(Bitmap.CompressFormat.PNG, 90, stream))
                }
                assertTrue("$name screenshot saved empty", output.length() > 300)
            } finally {
                image.recycle()
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.waitForIdleSync()
        }
    }

    @Test fun opensHomeActivityAndCapturesNonflatAndroidFrame() =
        inspect("home", HomeActivity::class.java)

    @Test fun opensVehicleActivityAndCapturesNonflatAndroidFrame() =
        inspect("vehicle", VehicleActivity::class.java)

    @Test fun opensAppearanceActivityAndCapturesNonflatAndroidFrame() =
        inspect("appearance", AppearanceActivity::class.java)

    @Test fun opensUsbCameraActivityAndCapturesNonflatAndroidFrame() =
        inspect("camera", UsbCameraActivity::class.java)

    @Test fun opensTelemetryActivityAndCapturesNonflatAndroidFrame() =
        inspect("telemetry", TelemetryActivity::class.java)

    @Test fun opensObdActivityAndCapturesNonflatAndroidFrame() =
        inspect("obd", ObdActivity::class.java)

    @Test fun opensTaxiMeterActivityAndCapturesNonflatAndroidFrame() =
        inspect("taximeter", TaxiMeterActivity::class.java)

    @Test fun opensReportActivityAndCapturesNonflatAndroidFrame() =
        inspect("reports", ReportActivity::class.java)

    @Test fun opensProfileActivityAndCapturesNonflatAndroidFrame() =
        inspect("profile", ProfileActivity::class.java)

    @Test fun opensAdminLicenseActivityAndCapturesNonflatAndroidFrame() =
        inspect("license", AdminLicenseActivity::class.java)

    @Test fun opensPrivacyActivityAndCapturesNonflatAndroidFrame() =
        inspect("privacy", PrivacyActivity::class.java)

    @Test fun opensNotificationActivityAndCapturesNonflatAndroidFrame() =
        inspect("notices", NotificationActivity::class.java)

    @Test fun opensRecoveryActivityAndCapturesNonflatAndroidFrame() =
        inspect("recovery", RecoveryActivity::class.java)

    @Test fun opensUpdateActivityAndCapturesNonflatAndroidFrame() =
        inspect("updates", UpdateActivity::class.java)

    @Test fun opensRemoteKeyConfigActivityAndCapturesNonflatAndroidFrame() =
        inspect("remote", RemoteKeyConfigActivity::class.java)

}
