package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.*
import org.junit.Test

class ExternalAppWindowBoundsRulesTest {
    @Test fun rightHandRegionIsInsideThreeRealisticExternalScreenSizes() {
        for ((width, height, density) in listOf(
            Triple(1920, 1080, 2f),
            Triple(1600, 900, 1.5f),
            Triple(1280, 720, 1f),
        )) {
            val b = ExternalAppWindowBoundsRules.initial(width, height, density)
            assertNotNull(b)
            b!!
            assertTrue("Reserve a narrow Home panel on the left", b.left >= width * .34)
            assertTrue("Right-side app should have useful width", b.width >= width * .55)
            assertTrue("App window right edge must fit", b.right <= width)
            assertTrue("App window bottom edge must fit", b.bottom <= height)
            assertTrue("App window must have useful height", b.height >= height * .75)
            assertTrue(b.top >= 0)
        }
    }

    @Test fun invalidOrUnphysicalMetricsFailClosed() {
        assertNull(ExternalAppWindowBoundsRules.initial(700, 1080, 2f))
        assertNull(ExternalAppWindowBoundsRules.initial(1920, 500, 2f))
        assertNull(ExternalAppWindowBoundsRules.initial(1920, 1080, Float.NaN))
        assertNull(ExternalAppWindowBoundsRules.initial(1920, 1080, Float.POSITIVE_INFINITY))
        assertNull(ExternalAppWindowBoundsRules.initial(1920, 1080, 0f))
        assertNull(ExternalAppWindowBoundsRules.initial(1920, 1080, 11f))
    }
}
