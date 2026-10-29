package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryRulesTest {
    @Test fun calculatesBatteryPercentageSafely() {
        assertEquals(50, TelemetryRules.batteryPercent(25, 50))
        assertEquals(100, TelemetryRules.batteryPercent(150, 100))
        assertNull(TelemetryRules.batteryPercent(-1, 100))
        assertNull(TelemetryRules.batteryPercent(50, 0))
    }

    @Test fun validatesGpsCoordinates() {
        assertTrue(TelemetryRules.validCoordinates(10.8231, 106.6297))
        assertTrue(TelemetryRules.validCoordinates(-90.0, -180.0))
        assertFalse(TelemetryRules.validCoordinates(90.1, 0.0))
        assertFalse(TelemetryRules.validCoordinates(0.0, 180.1))
        assertFalse(TelemetryRules.validCoordinates(Double.NaN, 0.0))
    }
}
