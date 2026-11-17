package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.content.Context
import android.content.Intent
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
 * Device-local button/persistence QA with exact preference restoration.
 * This does NOT assert original V1 visuals, physical UVC, DeX or Bluetooth.
 */
@RunWith(AndroidJUnit4::class)
class V2DeviceBehaviorSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app get() = instrumentation.targetContext

    private fun <T : Activity> launch(clazz: Class<T>): Activity {
        val activity = instrumentation.startActivitySync(
            Intent(app, clazz).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        instrumentation.waitForIdleSync()
        return activity
    }

    private fun find(root: View, match: (View) -> Boolean): View? {
        if (match(root)) return root
        if (root is ViewGroup) {
            for (index in 0 until root.childCount) {
                find(root.getChildAt(index), match)?.let { return it }
            }
        }
        return null
    }

    private fun button(activity: Activity, text: String): Button {
        val candidate = find(activity.window.decorView) {
            it is Button && it.text.toString() == text
        }
        assertNotNull("Button missing: $text", candidate)
        return candidate as Button
    }

    private fun click(activity: Activity, label: String) {
        val control = button(activity, label)
        instrumentation.runOnMainSync { assertTrue("Click rejected: $label", control.performClick()) }
        instrumentation.waitForIdleSync()
    }

    private fun stop(activity: Activity?) {
        if (activity == null) return
        instrumentation.runOnMainSync { activity.finish() }
        instrumentation.waitForIdleSync()
    }

    @Test fun f09DayNightToggleIsDurableAndRestored() {
        val preferences = app.getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
        val initiallyPresent = preferences.contains("night")
        val original = preferences.getBoolean("night", false)
        var first: Activity? = null
        var second: Activity? = null
        try {
            first = launch(AppearanceActivity::class.java)
            click(first, "ĐỔI NGÀY / ĐÊM")
            assertEquals(!original, preferences.getBoolean("night", false))
            stop(first)
            first = null

            second = launch(AppearanceActivity::class.java)
            assertEquals(!original, preferences.getBoolean("night", false))
            val status = find(second.window.decorView) {
                it is TextView && it.text.toString().contains("Chế độ:")
            }
            assertNotNull("Appearance state not shown", status)
        } finally {
            stop(second)
            stop(first)
            val editor = preferences.edit()
            if (initiallyPresent) editor.putBoolean("night", original) else editor.remove("night")
            assertTrue("Failed to restore QA appearance state", editor.commit())
        }
    }

    @Test fun f02VehicleSelectionAndPlateAreDurableAndRestored() {
        val preferences = app.getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
        val keys = listOf(VehicleRules.PREF_MODEL, VehicleRules.PREF_LICENSE_PLATE, "limo")
        val old = keys.associateWith { key ->
            if (preferences.contains(key)) preferences.all[key] else null
        }
        val present = keys.associateWith(preferences::contains)
        var first: Activity? = null
        var second: Activity? = null
        try {
            first = launch(VehicleActivity::class.java)
            click(first, "CHỌN LIMO ĐỎ")
            assertEquals(VehicleRules.MODEL_LIMO_RED, preferences.getString(VehicleRules.PREF_MODEL, null))
            val input = find(first.window.decorView) { it is EditText } as? EditText
            assertNotNull("License plate EditText missing", input)
            instrumentation.runOnMainSync { input!!.setText("51K-123.45") }
            click(first, "LƯU BIỂN SỐ")
            val expectedPlate = VehicleRules.normalizeLicensePlate("51K-123.45")
            assertEquals(expectedPlate, preferences.getString(VehicleRules.PREF_LICENSE_PLATE, null))
            stop(first)
            first = null

            second = launch(VehicleActivity::class.java)
            val restoredInput = find(second.window.decorView) { it is EditText } as? EditText
            assertEquals(expectedPlate, restoredInput?.text?.toString())
        } finally {
            stop(second)
            stop(first)
            val editor = preferences.edit()
            for (key in keys) {
                if (present[key] != true) editor.remove(key)
                else when (val value = old[key]) {
                    is Boolean -> editor.putBoolean(key, value)
                    is String -> editor.putString(key, value)
                    else -> editor.remove(key)
                }
            }
            assertTrue("Failed to restore QA vehicle state", editor.commit())
        }
    }

    @Test fun d04RemoteConfigToggleIsDurableWithoutGrantingAccessibility() {
        val preferences = app.getSharedPreferences(RemoteKeyRules.PREFS, Context.MODE_PRIVATE)
        val existing = preferences.contains(RemoteKeyRules.ENABLED)
        val original = preferences.getBoolean(RemoteKeyRules.ENABLED, false)
        var first: Activity? = null
        var second: Activity? = null
        try {
            first = launch(RemoteKeyConfigActivity::class.java)
            click(first, "BẬT / TẮT ĐIỀU KHIỂN")
            assertEquals(!original, preferences.getBoolean(RemoteKeyRules.ENABLED, false))
            stop(first)
            first = null

            second = launch(RemoteKeyConfigActivity::class.java)
            assertEquals(!original, preferences.getBoolean(RemoteKeyRules.ENABLED, false))
            // This test never opens the Android Accessibility permission screen.
            assertNotNull(button(second, "MỞ QUYỀN TRỢ NĂNG ANDROID"))
        } finally {
            stop(second)
            stop(first)
            val editor = preferences.edit()
            if (existing) editor.putBoolean(RemoteKeyRules.ENABLED, original)
            else editor.remove(RemoteKeyRules.ENABLED)
            assertTrue("Failed to restore QA remote state", editor.commit())
        }
    }
}
