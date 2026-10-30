package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeBackupRulesTest {
    @Test fun migratesLegacyBackupAndAcceptsCurrentSchema() {
        assertTrue(HomeBackupRules.canReadBackupSchema(1))
        assertTrue(HomeBackupRules.canReadBackupSchema(2))
        assertTrue(HomeBackupRules.canReadBackupSchema(3))
        assertFalse(HomeBackupRules.canReadBackupSchema(0))
        assertFalse(HomeBackupRules.canReadBackupSchema(4))
        assertFalse(HomeBackupRules.requiresOverlayPositions(1))
        assertTrue(HomeBackupRules.requiresOverlayPositions(2))
        assertTrue(HomeBackupRules.requiresOverlayPositions(3))
        assertFalse(HomeBackupRules.requiresVehicleState(1))
        assertFalse(HomeBackupRules.requiresVehicleState(2))
        assertTrue(HomeBackupRules.requiresVehicleState(3))
    }

    @Test fun boundsImportedBackupSize() {
        assertTrue(HomeBackupRules.withinSize(1))
        assertTrue(HomeBackupRules.withinSize(HomeBackupRules.MAX_BACKUP_BYTES))
        assertFalse(HomeBackupRules.withinSize(0))
        assertFalse(HomeBackupRules.withinSize(HomeBackupRules.MAX_BACKUP_BYTES + 1))
    }

    @Test fun validatesPortableOverlayKeysAndCoordinates() {
        assertEquals(0, HomeBackupRules.displayIdFromOverlayKey("display_0_x"))
        assertEquals(42, HomeBackupRules.displayIdFromOverlayKey("display_42_y"))
        assertNull(HomeBackupRules.displayIdFromOverlayKey("x"))
        assertNull(HomeBackupRules.displayIdFromOverlayKey("display_-1_x"))
        assertNull(HomeBackupRules.displayIdFromOverlayKey("display_1025_x"))
        assertTrue(HomeBackupRules.validOverlayCoordinate(0))
        assertTrue(HomeBackupRules.validOverlayCoordinate(HomeBackupRules.MAX_OVERLAY_COORDINATE))
        assertFalse(HomeBackupRules.validOverlayCoordinate(-1))
        assertFalse(HomeBackupRules.validOverlayCoordinate(HomeBackupRules.MAX_OVERLAY_COORDINATE + 1))
    }

    @Test fun acceptsOnlyExactBackupScalarTypes() {
        assertEquals(true, HomeBackupRules.exactBoolean(true))
        assertNull(HomeBackupRules.exactBoolean("true"))
        assertEquals("Driver", HomeBackupRules.exactString("Driver"))
        assertNull(HomeBackupRules.exactString(123))
        assertEquals(3, HomeBackupRules.exactInt(3))
        assertEquals(3, HomeBackupRules.exactInt(3L))
        assertEquals(3, HomeBackupRules.exactInt(3.0))
        assertNull(HomeBackupRules.exactInt("3"))
        assertNull(HomeBackupRules.exactInt(3.5))
        assertNull(HomeBackupRules.exactInt(Long.MAX_VALUE))
    }

    @Test fun usesStableJsonExportName() {
        assertEquals("ultracarhcm-v2-home-backup.json", HomeBackupRules.exportFileName())
    }
}
