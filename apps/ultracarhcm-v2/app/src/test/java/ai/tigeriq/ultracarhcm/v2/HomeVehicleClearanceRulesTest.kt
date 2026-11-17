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

    @Test fun invalidGeometryFailClosed() {
        val top = HomeLayoutRules.vehicleTopBeforeQuickBar(Float.NaN)
        assertTrue(top.isFinite())
        assertTrue(top >= .28f)
        assertTrue(top + .225f < .56f)
    }
}
