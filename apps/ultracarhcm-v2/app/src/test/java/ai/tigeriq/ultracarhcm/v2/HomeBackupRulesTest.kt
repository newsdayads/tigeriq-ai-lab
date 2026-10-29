package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeBackupRulesTest {
    @Test fun acceptsOnlyCurrentBackupSchema() {
        assertTrue(HomeBackupRules.canReadBackupSchema(1))
        assertFalse(HomeBackupRules.canReadBackupSchema(0))
        assertFalse(HomeBackupRules.canReadBackupSchema(2))
    }

    @Test fun boundsImportedBackupSize() {
        assertTrue(HomeBackupRules.withinSize(1))
        assertTrue(HomeBackupRules.withinSize(HomeBackupRules.MAX_BACKUP_BYTES))
        assertFalse(HomeBackupRules.withinSize(0))
        assertFalse(HomeBackupRules.withinSize(HomeBackupRules.MAX_BACKUP_BYTES + 1))
    }

    @Test fun usesStableJsonExportName() {
        assertEquals("ultracarhcm-v2-home-backup.json", HomeBackupRules.exportFileName())
    }
}
