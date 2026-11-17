package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real Samsung Android Canvas rendering & durable choice verification without
 * granting CAMERA, simulating reverse gear or claiming UVC video.
 */
@RunWith(AndroidJUnit4::class)
class V2GuideStyleDeviceSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun render(style: GuideStyle, reverseActive: Boolean): IntArray {
        var screenshot: IntArray? = null
        instrumentation.runOnMainSync {
            val view = DynamicGuideView(instrumentation.targetContext)
            view.layout(0, 0, 640, 480)
            view.updateStyle(style)
            view.updateGuide(
                GuideCurveState(
                    reverseActive = reverseActive,
                    steeringDegrees = 12f,
                    warp = 1f,
                ),
            )
            val image = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
            try {
                view.draw(Canvas(image))
                screenshot = IntArray(640 * 480).also { pixels ->
                    image.getPixels(pixels, 0, 640, 0, 0, 640, 480)
                }
            } finally {
                image.recycle()
            }
        }
        return screenshot ?: error("No Android Canvas frame")
    }

    @Test fun f05AllThreeStylesPaintRealDistinctDistanceGuides() {
        val samples = GuideStyle.values().map { render(it, reverseActive = true) }
        for (frame in samples) {
            assertTrue("Reverse guide rendered no actual pixels", frame.count { it != 0 } > 150)
        }
        assertFalse("Sport/Luxury must differ", samples[0].contentEquals(samples[1]))
        assertFalse("Sport/Minimal must differ", samples[0].contentEquals(samples[2]))
        assertFalse("Luxury/Minimal must differ", samples[1].contentEquals(samples[2]))
    }

    @Test fun f05ReverseInactiveNeverPaintsFakeGuide() {
        for (style in GuideStyle.values()) {
            val noReverse = render(style, reverseActive = false)
            assertTrue("A visible parking guide without verified reverse input is forbidden",
                noReverse.all { it == 0 })
        }
    }

    @Test fun f05StylePreferencePersistsAndRestoresWithoutSideEffects() {
        val preferences = instrumentation.targetContext.getSharedPreferences(
            GuideStyleRules.PREFS,
            Context.MODE_PRIVATE,
        )
        val hadOriginal = preferences.contains(GuideStyleRules.PREF_STYLE)
        val original = preferences.getString(GuideStyleRules.PREF_STYLE, null)
        try {
            assertTrue(preferences.edit()
                .putString(GuideStyleRules.PREF_STYLE, GuideStyle.LUXURY_OEM.name)
                .commit())
            assertEquals(
                GuideStyle.LUXURY_OEM,
                GuideStyleRules.parse(preferences.getString(GuideStyleRules.PREF_STYLE, null)),
            )
        } finally {
            val editor = preferences.edit()
            if (hadOriginal) editor.putString(GuideStyleRules.PREF_STYLE, original)
            else editor.remove(GuideStyleRules.PREF_STYLE)
            assertTrue("Could not restore original QA preference", editor.commit())
        }
    }
}
