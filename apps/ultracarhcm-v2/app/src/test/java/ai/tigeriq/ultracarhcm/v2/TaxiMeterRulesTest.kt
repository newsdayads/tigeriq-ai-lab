package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TaxiMeterRulesTest {
    @Test fun parsesOwnerConfiguredRateWithoutGuessingDefaults() {
        assertEquals(7000.0, TaxiMeterRules.parseRateVndPerKm("7000")!!, 0.0)
        assertEquals(7500.5, TaxiMeterRules.parseRateVndPerKm("7500,5")!!, 0.0)
        assertNull(TaxiMeterRules.parseRateVndPerKm(""))
        assertNull(TaxiMeterRules.parseRateVndPerKm("0"))
        assertNull(TaxiMeterRules.parseRateVndPerKm("-1"))
    }

    @Test fun validatesConfiguredRateBounds() {
        assertTrue(TaxiMeterRules.validRateVndPerKm(1.0))
        assertTrue(TaxiMeterRules.validRateVndPerKm(1_000_000.0))
        assertNull(TaxiMeterRules.parseRateVndPerKm("1000001"))
        assertNull(TaxiMeterRules.parseRateVndPerKm("NaN"))
    }

    @Test fun calculatesDistanceBetweenValidCoordinates() {
        val meters = TaxiMeterRules.segmentMeters(10.8231, 106.6297, 10.8241, 106.6297)!!
        assertTrue(meters in 110.0..112.5)
        assertEquals(0.0, TaxiMeterRules.segmentMeters(10.8231, 106.6297, 10.8231, 106.6297)!!, 0.001)
        assertNull(TaxiMeterRules.segmentMeters(91.0, 0.0, 10.0, 10.0))
    }

    @Test fun calculatesDistanceBasedFareOnlyFromConfiguredRate() {
        assertEquals(14000L, TaxiMeterRules.fareVnd(7000.0, 2000.0))
        assertEquals(0L, TaxiMeterRules.fareVnd(7000.0, 0.0))
        assertNull(TaxiMeterRules.fareVnd(0.0, 1000.0))
        assertNull(TaxiMeterRules.fareVnd(7000.0, -1.0))
    }

    @Test fun reportsOnlyNonNegativeElapsedSeconds() {
        assertEquals(0L, TaxiMeterRules.elapsedSeconds(-1000L))
        assertEquals(0L, TaxiMeterRules.elapsedSeconds(999L))
        assertEquals(61L, TaxiMeterRules.elapsedSeconds(61_999L))
    }
}
