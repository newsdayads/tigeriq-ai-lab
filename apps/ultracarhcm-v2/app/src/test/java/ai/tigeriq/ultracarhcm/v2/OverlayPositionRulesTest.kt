package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Test

class OverlayPositionRulesTest {
    @Test fun buildsStablePerDisplayKeys() {
        assertEquals("display_7_x", OverlayPositionRules.xKey(7))
        assertEquals("display_7_y", OverlayPositionRules.yKey(7))
    }

    @Test fun restoresDisplayPositionWithPortableCrossDeviceFallback() {
        assertEquals(10, OverlayPositionRules.restoredCoordinate(10, 20, 30, 40))
        assertEquals(20, OverlayPositionRules.restoredCoordinate(null, 20, 30, 40))
        assertEquals(30, OverlayPositionRules.restoredCoordinate(null, null, 30, 40))
        assertEquals(40, OverlayPositionRules.restoredCoordinate(null, null, null, 40))
    }

    @Test fun clampsPositionInsideDisplayBounds() {
        assertEquals(OverlayPosition(0, 0), OverlayPositionRules.clamp(-20, -30, 1920, 1080, 56))
        assertEquals(OverlayPosition(1864, 1024), OverlayPositionRules.clamp(9999, 9999, 1920, 1080, 56))
        assertEquals(OverlayPosition(20, 30), OverlayPositionRules.clamp(20, 30, 1920, 1080, 56))
    }

    @Test fun handlesDisplaySmallerThanShortcut() {
        assertEquals(OverlayPosition(0, 0), OverlayPositionRules.clamp(10, 10, 40, 30, 56))
    }
}
