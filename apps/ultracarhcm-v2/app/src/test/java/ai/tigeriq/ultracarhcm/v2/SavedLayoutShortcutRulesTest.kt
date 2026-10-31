package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedLayoutShortcutRulesTest {
    @Test fun exposesExactlyFiveStableSlotKeys() {
        assertEquals("slot_0", SavedLayoutShortcutRules.slotKey(0))
        assertEquals("slot_4", SavedLayoutShortcutRules.slotKey(4))
        assertNull(SavedLayoutShortcutRules.slotKey(-1))
        assertNull(SavedLayoutShortcutRules.slotKey(5))
    }

    @Test fun normalizesUuidConfigIds() {
        assertEquals(
            "550e8400-e29b-41d4-a716-446655440000",
            SavedLayoutShortcutRules.normalizeConfigId(
                " 550E8400-E29B-41D4-A716-446655440000 ",
            ),
        )
    }

    @Test fun acceptsOnlyBoundedUuidConfigIds() {
        assertTrue(SavedLayoutShortcutRules.validConfigId("550e8400-e29b-41d4-a716-446655440000"))
        assertFalse(SavedLayoutShortcutRules.validConfigId(""))
        assertFalse(SavedLayoutShortcutRules.validConfigId("layout-1"))
        assertFalse(SavedLayoutShortcutRules.validConfigId("550e8400-e29b-01d4-a716-446655440000"))
    }

    @Test fun generatesValidConfigIds() {
        repeat(4) {
            assertTrue(SavedLayoutShortcutRules.validConfigId(SavedLayoutShortcutRules.freshConfigId()))
        }
    }
}
