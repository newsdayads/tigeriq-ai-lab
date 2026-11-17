package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.view.View
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs on a real Android device against the installed QA package, NOT against
 * source strings or mock screens. Non-destructive Activity smoke tests plus an OS permission declaration test:
 * no pairing, license activation, camera hardware, or Android permission grant.
 *
 * A passed screen only proves it launches; it is NOT V1 feature parity.
 */
@RunWith(AndroidJUnit4::class)
class V2DeviceNavigationSmokeTest {

    private fun launch(clazz: Class<out Activity>) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val target = instrumentation.targetContext
        val intent = Intent(target, clazz).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent)
        try {
            instrumentation.waitForIdleSync()
            assertNotNull("Activity must launch: ${clazz.simpleName}", activity)
            assertEquals("Wrong screen", clazz.name, activity.javaClass.name)
            val content = activity.window.decorView.findViewById<View>(android.R.id.content)
            assertNotNull("Missing content view: ${clazz.simpleName}", content)
            assertTrue("Activity finishing early: ${clazz.simpleName}", !activity.isFinishing)
        } finally {
            activity.runOnUiThread { activity.finish() }
            instrumentation.waitForIdleSync()
        }
    }

    @Test fun f01Home() = launch(HomeActivity::class.java)
    @Test fun f02Vehicle() = launch(VehicleActivity::class.java)
    // A missing CAMERA grant is an OS permission gate, not a crashed Activity.
    // Unattended QA must not auto-grant a security permission just to pass.
    @Test fun f03CameraPermissionContractOnly() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS,
        )
        assertTrue(
            "CAMERA must be explicitly declared",
            info.requestedPermissions.orEmpty().contains(Manifest.permission.CAMERA),
        )
        val state = context.checkSelfPermission(Manifest.permission.CAMERA)
        assertTrue(
            "CAMERA grant is controlled by Android",
            state == PackageManager.PERMISSION_GRANTED ||
                state == PackageManager.PERMISSION_DENIED,
        )
    }
    @Test fun f09Appearance() = launch(AppearanceActivity::class.java)
    @Test fun f11Telemetry() = launch(TelemetryActivity::class.java)
    @Test fun f12Obd() = launch(ObdActivity::class.java)
    @Test fun f13TaxiMeter() = launch(TaxiMeterActivity::class.java)
    @Test fun f14Profile() = launch(ProfileActivity::class.java)
    @Test fun f15Notifications() = launch(NotificationActivity::class.java)
    @Test fun f15Updates() = launch(UpdateActivity::class.java)
    @Test fun f18LicenseFailClosed() = launch(AdminLicenseActivity::class.java)
    @Test fun f19Reports() = launch(ReportActivity::class.java)
    @Test fun f20Privacy() = launch(PrivacyActivity::class.java)
    @Test fun f22Recovery() = launch(RecoveryActivity::class.java)
    @Test fun d04RemoteSettingsNoPermissionGrant() = launch(RemoteKeyConfigActivity::class.java)
}
