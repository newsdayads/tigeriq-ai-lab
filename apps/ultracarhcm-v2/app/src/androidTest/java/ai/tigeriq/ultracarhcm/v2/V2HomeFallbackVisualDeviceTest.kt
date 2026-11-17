package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real Android Canvas/Activity verification for ORIGINAL V2-owned illustrated
 * fallback. Not a pixel-exact copy of private V1 artwork or real Samsung DeX.
 */
@RunWith(AndroidJUnit4::class)
class V2HomeFallbackVisualDeviceTest {
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val context = inst.targetContext

    private fun paint(view: View, w: Int = 960, h: Int = 540): IntArray {
        var pixels: IntArray? = null
        inst.runOnMainSync {
            view.layout(0, 0, w, h)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            try {
                view.draw(Canvas(bitmap))
                pixels = IntArray(w * h).also {
                    bitmap.getPixels(it, 0, w, 0, 0, w, h)
                }
            } finally {
                bitmap.recycle()
            }
        }
        return pixels ?: error("Canvas not drawn")
    }

    private fun childOfType(view: View, type: Class<out View>): View? {
        if (type.isInstance(view)) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                childOfType(view.getChildAt(i), type)?.let { return it }
            }
        }
        return null
    }

    @Test fun cityBackgroundIsOriginalDetailedAndDifferentDayNight() {
        val night = paint(RoadCityFallbackView(context, true))
        val day = paint(RoadCityFallbackView(context, false))
        assertFalse("Day and night vector art must differ", night.contentEquals(day))
        assertTrue("Fallback must not be a flat placeholder",
            night.filterIndexed { i, _ -> i % 43 == 0 }.distinct().size > 40)
        assertTrue("Fallback must not be a flat placeholder",
            day.filterIndexed { i, _ -> i % 43 == 0 }.distinct().size > 40)
    }

    @Test fun vehicleSilhouetteExistsForBothUserSelectedModels() {
        val sport = paint(ParkedVehicleFallbackView(context, VehicleRules.MODEL_LAMBORGHINI_WHITE))
        val limo = paint(ParkedVehicleFallbackView(context, VehicleRules.MODEL_LIMO_RED))
        assertFalse("Vehicle types must have different original artwork", sport.contentEquals(limo))
        assertTrue("Vehicle fallback must contain real drawn pixels",
            sport.count { it != 0 } > 10_000)
        assertTrue("Limo fallback must contain real drawn pixels",
            limo.count { it != 0 } > 10_000)
    }

    @Test fun actualHomeUsesFallbackOnlyWhenBundledLicensedResourcesAreAbsent() {
        val intent = Intent(context, HomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity: Activity = inst.startActivitySync(intent)
        try {
            inst.waitForIdleSync()
            val decor = activity.window.decorView
            assertNotNull("Actual Home UI absent", decor)
            val roadResource = context.resources.getIdentifier(
                "v2_road_city_day", "drawable", context.packageName)
            val roadResourceNight = context.resources.getIdentifier(
                "v2_road_city_night", "drawable", context.packageName)
            if (roadResource == 0 && roadResourceNight == 0) {
                assertNotNull("Missing detailed street illustration",
                    childOfType(decor, RoadCityFallbackView::class.java))
            }
            val sportResource = context.resources.getIdentifier(
                "v2_car_lambogini_trang_parked", "drawable", context.packageName)
            val limoResource = context.resources.getIdentifier(
                "v2_car_limo_do_parked", "drawable", context.packageName)
            if (sportResource == 0 && limoResource == 0) {
                assertNotNull("Missing illustrated car in Home",
                    childOfType(decor, ParkedVehicleFallbackView::class.java))
            }
        } finally {
            inst.runOnMainSync { activity.finish() }
            inst.waitForIdleSync()
        }
    }
}
