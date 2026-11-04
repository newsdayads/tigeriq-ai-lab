package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        assertEquals(1_000_000L, TaxiMeterRules.fareVnd(1_000_000.0, 1000.0))
        assertNull(TaxiMeterRules.fareVnd(0.0, 1000.0))
        assertNull(TaxiMeterRules.fareVnd(1_000_000.01, 1000.0))
        assertNull(TaxiMeterRules.fareVnd(Double.POSITIVE_INFINITY, 1000.0))
        assertNull(TaxiMeterRules.fareVnd(1_000_000.0, Double.MAX_VALUE))
        assertNull(TaxiMeterRules.fareVnd(7000.0, -1.0))
    }

    @Test fun validatesRestoredActiveTripStateFailClosed() {
        assertTrue(TaxiMeterRules.validActiveTripState(7000.0, 1250.5, 61_000L, 1_700_000_000_000L))
        assertFalse(TaxiMeterRules.validActiveTripState(Double.NaN, 1250.5, 61_000L, 1_700_000_000_000L))
        assertFalse(TaxiMeterRules.validActiveTripState(7000.0, Double.POSITIVE_INFINITY, 61_000L, 1_700_000_000_000L))
        assertFalse(TaxiMeterRules.validActiveTripState(7000.0, -1.0, 61_000L, 1_700_000_000_000L))
        assertFalse(TaxiMeterRules.validActiveTripState(7000.0, 1250.5, -1L, 1_700_000_000_000L))
        assertFalse(TaxiMeterRules.validActiveTripState(7000.0, 1250.5, 61_000L, 0L))
    }

    @Test fun validatesExactPersistedNumericScalars() {
        assertEquals(7L, TaxiMeterRules.exactLong(7))
        assertEquals(7L, TaxiMeterRules.exactLong(7.0))
        assertNull(TaxiMeterRules.exactLong(7.5))
        assertNull(TaxiMeterRules.exactLong("7"))
        assertEquals(7.5, TaxiMeterRules.exactDouble(7.5)!!, 0.0)
        assertNull(TaxiMeterRules.exactDouble("7.5"))
        assertNull(TaxiMeterRules.exactDouble(Double.POSITIVE_INFINITY))
    }

    @Test fun validatesPersistedTripAgainstCanonicalRateAndFare() {
        assertTrue(
            TaxiMeterRules.validPersistedTrip(
                1_700_000_000_000L,
                120L,
                2_000.0,
                7_000.0,
                14_000L,
            ),
        )
        assertFalse(
            TaxiMeterRules.validPersistedTrip(
                1_700_000_000_000L,
                120L,
                2_000.0,
                1_000_000.01,
                2_000_000L,
            ),
        )
        assertFalse(
            TaxiMeterRules.validPersistedTrip(
                1_700_000_000_000L,
                120L,
                2_000.0,
                7_000.0,
                14_001L,
            ),
        )
        assertFalse(TaxiMeterRules.validPersistedTrip(0L, 120L, 2_000.0, 7_000.0, 14_000L))
        assertFalse(TaxiMeterRules.validPersistedTrip(1L, -1L, 2_000.0, 7_000.0, 14_000L))
        assertFalse(
            TaxiMeterRules.validPersistedTrip(
                1L,
                1L,
                Double.POSITIVE_INFINITY,
                7_000.0,
                Long.MAX_VALUE,
            ),
        )
        assertFalse(
            TaxiMeterRules.validPersistedTrip(
                1L,
                1L,
                Double.MAX_VALUE,
                1_000_000.0,
                Long.MAX_VALUE,
            ),
        )
    }

    @Test fun reportsOnlyNonNegativeElapsedSeconds() {
        assertEquals(0L, TaxiMeterRules.elapsedSeconds(-1000L))
        assertEquals(0L, TaxiMeterRules.elapsedSeconds(999L))
        assertEquals(61L, TaxiMeterRules.elapsedSeconds(61_999L))
        assertEquals(12L, TaxiMeterRules.saturatingAddNonNegative(5L, 7L))
        assertEquals(7L, TaxiMeterRules.saturatingAddNonNegative(-5L, 7L))
        assertEquals(Long.MAX_VALUE, TaxiMeterRules.saturatingAddNonNegative(Long.MAX_VALUE, 1L))
    }
}
