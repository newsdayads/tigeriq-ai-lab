package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.*
import org.junit.Test

class HomeVehicleClearanceRulesTest {
    @Test fun vehicleAndLicensePlateNeverOverlapNineShortcutsAcrossDexLayouts() {
        val barTops = listOf(.56f, .597f, .620f, .690f, .800f)
        for (barTop in barTops) {
            val carTop = HomeLayoutRules.vehicleTopBeforeQuickBar(barTop)
            val carBottom = carTop + .225f
            val plateBottom = carTop + .184f + .032f
            assertTrue("Car overlaps bar at $barTop", carBottom + .01f < barTop)
            assertTrue("Plate overlaps bar at $barTop", plateBottom + .01f < barTop)
        }
    }

    @Test fun quickBarLeavesStartButtonGapAcrossViewportSizes() {
        for (height in listOf(480, 600, 720, 800, 900, 1080, 1440, 1600, 1920, 2160, 2880, 4320)) {
            for (density in listOf(.75f, 1f, 1.25f, 1.5f, 2f, 2.5f, 3f, 4f)) {
                val lift = (50 * density + .5f).toInt()
                val top = HomeLayoutRules.quickBarTop(height, lift)
                val bottom = top + .145f
                val start = maxOf(.73f, bottom + .006f).coerceAtMost(.80f)
                val endPx = (top * height).toInt() + (.145f * height).toInt()
                assertTrue(top >= .56f && top <= .647f)
                assertTrue("QuickBar overlaps start at $height/$density", endPx < (start * height).toInt())
            }
        }
        assertEquals(.647f, HomeLayoutRules.quickBarTop(2160, 50), .00001f)
        assertEquals(.56f, HomeLayoutRules.quickBarTop(0, 50), .00001f)
        assertEquals(.56f, HomeLayoutRules.quickBarTop(-1, 50), .00001f)
        assertEquals(.56f, HomeLayoutRules.quickBarTop(1080, -1), .00001f)
    }

    @Test fun invalidGeometryFailClosed() {
        val top = HomeLayoutRules.vehicleTopBeforeQuickBar(Float.NaN)
        assertTrue(top.isFinite())
        assertTrue(top >= .28f)
        assertTrue(top + .225f < .56f)
    }
}
