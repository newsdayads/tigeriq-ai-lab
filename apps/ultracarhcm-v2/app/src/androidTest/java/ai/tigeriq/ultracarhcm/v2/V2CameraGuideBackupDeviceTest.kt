package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real Android SharedPreferences round-trip for schema-v6 Camera guide style.
 * QA-only package, no media/Android permission changes and no V1 data access.
 */
@RunWith(AndroidJUnit4::class)
class V2CameraGuideBackupDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val prefs get() = instrumentation.targetContext.getSharedPreferences(
        GuideStyleRules.PREFS, Context.MODE_PRIVATE,
    )

    private fun withBackupHome(block: (Activity) -> Unit) {
        val existed = prefs.contains(GuideStyleRules.PREF_STYLE)
        val original = prefs.getString(GuideStyleRules.PREF_STYLE, null)
        var activity: Activity? = null
        try {
            activity = instrumentation.startActivitySync(
                Intent(instrumentation.targetContext, HomeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            instrumentation.waitForIdleSync()
            block(activity)
        } finally {
            activity?.let { current ->
                instrumentation.runOnMainSync { current.finish() }
                instrumentation.waitForIdleSync()
            }
            val editor = prefs.edit()
            if (existed) editor.putString(GuideStyleRules.PREF_STYLE, original)
            else editor.remove(GuideStyleRules.PREF_STYLE)
            assertTrue("Could not restore QA guide style", editor.commit())
        }
    }

    private fun export(activity: Activity): JSONObject {
        val method = HomeActivity::class.java.getDeclaredMethod("exportHomeBackupJson")
        method.isAccessible = true
        return method.invoke(activity) as JSONObject
    }

    private fun restore(activity: Activity, payload: JSONObject): Boolean {
        val method = HomeActivity::class.java.getDeclaredMethod(
            "importHomeBackupJson", String::class.java,
        )
        method.isAccessible = true
        return method.invoke(activity, payload.toString()) as Boolean
    }

    @Test fun f16SchemaV6ExportsAndRestoresVisualGuideStyle() = withBackupHome { home ->
        assertTrue(prefs.edit()
            .putString(GuideStyleRules.PREF_STYLE, GuideStyle.SPORT_RACING.name).commit())
        val backup = export(home)
        assertEquals(6, backup.getInt("backupSchemaVersion"))
        assertEquals(GuideStyle.SPORT_RACING.name, backup.getString("cameraGuideStyle"))
        assertTrue(prefs.edit()
            .putString(GuideStyleRules.PREF_STYLE, GuideStyle.LUXURY_OEM.name).commit())
        assertTrue("Full V2 backup import failed", restore(home, backup))
        assertEquals(
            GuideStyle.SPORT_RACING.name,
            prefs.getString(GuideStyleRules.PREF_STYLE, null),
        )
    }

    @Test fun f16LegacySchemaV5DoesNotResetExistingVisualGuideStyle() = withBackupHome { home ->
        val backup = export(home)
        backup.put("backupSchemaVersion", 5)
        backup.remove("cameraGuideStyle")
        assertTrue(prefs.edit()
            .putString(GuideStyleRules.PREF_STYLE, GuideStyle.LUXURY_OEM.name).commit())
        assertTrue("Legacy v5 import must stay supported", restore(home, backup))
        assertEquals(
            GuideStyle.LUXURY_OEM.name,
            prefs.getString(GuideStyleRules.PREF_STYLE, null),
        )
    }

    @Test fun f16InvalidCameraStyleFailsBeforePreferenceWrite() = withBackupHome { home ->
        assertTrue(prefs.edit()
            .putString(GuideStyleRules.PREF_STYLE, GuideStyle.MINIMALIST_MODERN.name).commit())
        val backup = export(home)
        backup.put("cameraGuideStyle", "UNVERIFIED_NOT_A_STYLE")
        assertFalse("Invalid schema v6 style must reject", restore(home, backup))
        assertEquals(
            GuideStyle.MINIMALIST_MODERN.name,
            prefs.getString(GuideStyleRules.PREF_STYLE, null),
        )
    }
}
