package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.*
import org.junit.Test

class CameraWindowBoundsRulesTest {
    @Test fun externalDexPopupIsBounded() {
        val b = CameraWindowBoundsRules.initial(1920, 1080, 1f)
        assertNotNull(b)
        assertEquals(430, b!!.width)
        assertEquals(301, b.height)
        assertEquals(20, b.left)
        assertEquals(48, b.top)
        assertTrue(b.right <= 1920)
        assertTrue(b.bottom <= 1080)
    }

    @Test fun highDensityExternalDisplayUsesExternalDensity() {
        val b = CameraWindowBoundsRules.initial(2560, 1440, 1.5f)!!
        assertEquals(645, b.width)
        assertEquals(452, b.height)
        assertEquals(30, b.left)
        assertEquals(72, b.top)
    }

    @Test fun invalidDisplayFailsClosed() {
        assertNull(CameraWindowBoundsRules.initial(1080, 0, 1f))
        assertNull(CameraWindowBoundsRules.initial(360, 800, 1f))
        assertNull(CameraWindowBoundsRules.initial(1920, 1080, Float.NaN))
        assertNull(CameraWindowBoundsRules.initial(1920, 1080, 0f))
    }
}
