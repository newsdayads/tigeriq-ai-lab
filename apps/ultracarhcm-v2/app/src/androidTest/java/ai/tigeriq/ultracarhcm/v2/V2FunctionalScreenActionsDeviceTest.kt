package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real native-view actions on the isolated V2 QA package, not V1, OEM DeX,
 * UVC, Gear R, production APK, or a hypothetical source-only mock.
 */
@RunWith(AndroidJUnit4::class)
class V2FunctionalScreenActionsDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app = instrumentation.targetContext

    private fun guardQaOnly() {
        assertEquals("ai.tigeriq.ultracarhcm.v2.vqa", app.packageName)
    }

    private fun openScreen(screen: Class<out Activity>): Activity {
        guardQaOnly()
        val intent = Intent(app, screen)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
        val activity = instrumentation.startActivitySync(intent)
        assertEquals(screen, activity.javaClass)
        instrumentation.waitForIdleSync()
        return activity
    }

    private fun closeScreen(activity: Activity?) {
        if (activity != null) {
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.waitForIdleSync()
        }
    }

    private fun allViews(view: View): List<View> {
        val found = ArrayList<View>()
        fun walk(node: View) {
            found.add(node)
            if (node is ViewGroup) {
                for (i in 0 until node.childCount) walk(node.getChildAt(i))
            }
        }
        walk(view)
        return found
    }

    private fun root(activity: Activity): View =
        activity.findViewById(android.R.id.content)

    private fun findButton(activity: Activity, title: String): Button =
        allViews(root(activity)).filterIsInstance<Button>()
            .singleOrNull { it.text.toString() == title }
            ?: throw AssertionError("Missing real button: $title")

    private fun visibleText(activity: Activity): String =
        allViews(root(activity)).filterIsInstance<TextView>()
            .filter { it.visibility == View.VISIBLE }
            .joinToString("\n") { it.text.toString() }

    private fun performClick(button: Button) {
        instrumentation.runOnMainSync { assertTrue(button.performClick()) }
        instrumentation.waitForIdleSync()
    }

    private fun restorePrefs(prefs: SharedPreferences, snapshot: Map<String, *>): Boolean {
        val edit = prefs.edit().clear()
        for ((key, value) in snapshot) {
            when (value) {
                is String -> edit.putString(key, value)
                is Long -> edit.putLong(key, value)
                is Int -> edit.putInt(key, value)
                is Boolean -> edit.putBoolean(key, value)
                is Float -> edit.putFloat(key, value)
                is Set<*> -> edit.putStringSet(key, value.filterIsInstance<String>().toSet())
            }
        }
        return edit.commit()
    }

    @Test fun f02VehicleButtonsAndPlateSaveReallyPersistThenRestore() {
        guardQaOnly()
        val prefs = app.getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
        val original = prefs.all.toMap()
        var activity: Activity? = null
        try {
            activity = openScreen(VehicleActivity::class.java)
            performClick(findButton(activity, "CHỌN LIMO ĐỎ"))
            assertEquals(VehicleRules.MODEL_LIMO_RED,
                prefs.getString(VehicleRules.PREF_MODEL, null))
            assertTrue("F02 legacy Limo migration flag not persisted",
                prefs.getBoolean("limo", false))
            assertTrue(visibleText(activity).contains(VehicleRules.modelLabel(VehicleRules.MODEL_LIMO_RED)))

            performClick(findButton(activity, "CHỌN LAMBORGHINI TRẮNG"))
            assertEquals(VehicleRules.MODEL_LAMBORGHINI_WHITE,
                prefs.getString(VehicleRules.PREF_MODEL, null))
            assertFalse("F02 legacy migration flag not reset",
                prefs.getBoolean("limo", true))

            val plate = allViews(root(activity)).filterIsInstance<EditText>().single()
            instrumentation.runOnMainSync { plate.setText(" 51k-123.45  ") }
            performClick(findButton(activity, "LƯU BIỂN SỐ"))
            assertEquals("51K-123.45",
                prefs.getString(VehicleRules.PREF_LICENSE_PLATE, null))
            assertTrue("F02 normalized plate not rendered",
                visibleText(activity).contains("51K-123.45"))
        } finally {
            closeScreen(activity)
            assertTrue("F02 QA vehicle/home preferences were not restored",
                restorePrefs(prefs, original))
            assertEquals("F02 original QA vehicle/home snapshot not restored",
                original, prefs.all)
        }
    }

    @Test fun f09NightModeButtonReallyUpdatesUIAndPersistsThenRestores() {
        guardQaOnly()
        val prefs = app.getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
        val existed = prefs.contains("night")
        val old = prefs.getBoolean("night", false)
        var activity: Activity? = null
        try {
            activity = openScreen(AppearanceActivity::class.java)
            val control = findButton(activity, "ĐỔI NGÀY / ĐÊM")
            performClick(control)
            assertEquals("F09 night flag not persisted", !old, prefs.getBoolean("night", old))
            assertTrue("F09 visible status did not refresh",
                visibleText(activity).contains(AppearanceRules.modeLabel(!old)))
        } finally {
            closeScreen(activity)
            val rollback = prefs.edit()
            if (existed) rollback.putBoolean("night", old) else rollback.remove("night")
            assertTrue("F09 QA preference restoration failed", rollback.commit())
            assertEquals("F09 QA original presence not restored", existed, prefs.contains("night"))
        }
    }

    @Test fun f15NoticeReadAndClearReallyPersistThenRestoreSnapshot() {
        guardQaOnly()
        val prefs = app.getSharedPreferences(NotificationRules.PREFS_NAME, Context.MODE_PRIVATE)
        val original = prefs.all.toMap()
        var activity: Activity? = null
        try {
            assertTrue("QA-only seeded notification failed",
                prefs.edit()
                    .putLong(NotificationRules.KEY_VERSION_CODE, 90000000L)
                    .putString(NotificationRules.KEY_VERSION_NAME, "QA-TEST-NOT-PUBLISHED")
                    .putString(NotificationRules.KEY_RELEASE_NOTES, "Isolated device test only")
                    .putLong(NotificationRules.KEY_CREATED_AT, 1L)
                    .putBoolean(NotificationRules.KEY_READ, false)
                    .commit())
            activity = openScreen(NotificationActivity::class.java)
            assertTrue("F15 pending notice missing", visibleText(activity).contains("Chưa đọc"))
            val markRead = findButton(activity, "ĐÁNH DẤU ĐÃ ĐỌC")
            assertTrue("F15 read action must be enabled", markRead.isEnabled)
            performClick(markRead)
            assertTrue("F15 read flag not persisted",
                prefs.getBoolean(NotificationRules.KEY_READ, false))
            assertTrue("F15 read UI missing", visibleText(activity).contains("Đã đọc"))
            performClick(findButton(activity, "XÓA THÔNG BÁO CỤC BỘ"))
            assertFalse("F15 clear left a stale notice",
                prefs.contains(NotificationRules.KEY_VERSION_CODE))
            assertTrue("F15 empty state missing",
                visibleText(activity).contains("Chưa có thông báo cập nhật V2"))
            assertFalse("F15 read button still active after clear", markRead.isEnabled)
        } finally {
            closeScreen(activity)
            assertTrue("F15 QA notice domain restoration failed",
                restorePrefs(prefs, original))
            assertEquals("F15 QA original notice snapshot not restored", original, prefs.all)
        }
    }

    @Test fun f15UpdateCannotDownloadOrInstallBeforeVerifiedMetadata() {
        var activity: Activity? = null
        try {
            activity = openScreen(UpdateActivity::class.java)
            assertTrue(visibleText(activity).contains("CẬP NHẬT ULTRACARHCM V2"))
            assertEquals(View.GONE, findButton(activity, "TẢI & XÁC MINH APK").visibility)
            assertEquals(View.GONE,
                findButton(activity, "MỞ TRÌNH CÀI ĐẶT ANDROID").visibility)
            assertTrue(findButton(activity, "KIỂM TRA CẬP NHẬT").isEnabled)
            // Deliberately NO check button click: no endpoint/network or installer.
        } finally {
            closeScreen(activity)
        }
    }

    @Test fun f18LicenseDisplaysActualQAIdentityAndNoFakeActivation() {
        var activity: Activity? = null
        try {
            activity = openScreen(AdminLicenseActivity::class.java)
            val text = visibleText(activity)
            assertTrue(text.contains("Package: ai.tigeriq.ultracarhcm.v2.vqa"))
            assertTrue(text.contains("Backend giấy phép: CHƯA CẤU HÌNH"))
            assertTrue(text.contains("Kích hoạt khách hàng: KHÔNG KHẢ DỤNG"))
            assertTrue(text.contains("Đăng ký thiết bị: KHÔNG KHẢ DỤNG"))
            assertTrue(text.contains("CHỈ ĐỌC / FAIL-CLOSED"))
            assertTrue("F18 must not invent activation controls",
                allViews(root(activity)).filterIsInstance<Button>().isEmpty())
        } finally {
            closeScreen(activity)
        }
    }

    @Test fun f19ReportShowsActualSummaryAndUserSelectedCsvAction() {
        var activity: Activity? = null
        try {
            activity = openScreen(ReportActivity::class.java)
            val text = visibleText(activity)
            assertTrue("F19 summary missing", text.contains("Tổng chuyến:"))
            assertTrue("F19 recorded revenue missing", text.contains("Doanh thu ghi nhận:"))
            assertTrue(findButton(activity, "XUẤT CSV").isEnabled)
            // SAF requires user document selection; never click automatically.
        } finally {
            closeScreen(activity)
        }
    }

    @Test fun f20PrivacyShowsActualPermissionStateWithoutGrantingAnything() {
        var activity: Activity? = null
        try {
            activity = openScreen(PrivacyActivity::class.java)
            val text = visibleText(activity)
            for (key in listOf("Camera:", "Vị trí gần đúng:", "Vị trí chính xác:",
                "Bluetooth Connect:", "Overlay DeX:")) {
                assertTrue("F20 missing real permission status: $key", text.contains(key))
            }
            assertTrue(findButton(activity, "MỞ CÀI ĐẶT ỨNG DỤNG").isEnabled)
            assertTrue(findButton(activity,
                "MỞ QUYỀN HIỂN THỊ TRÊN ỨNG DỤNG KHÁC").isEnabled)
            // No settings launch or permission grant is exercised.
        } finally {
            closeScreen(activity)
        }
    }
}
