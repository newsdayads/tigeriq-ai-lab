package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeConfigRulesTest {
    @Test fun trimsAndLimitsSavedName() {
        assertEquals("Tài xế", HomeConfigRules.normalizeName("  Tài xế  "))
        assertEquals("A".repeat(48), HomeConfigRules.normalizeName("A".repeat(60)))
        assertEquals("", HomeConfigRules.normalizeName(" \t "))
    }

    @Test fun allowsAtMostTwentyLocalConfigurations() {
        assertTrue(HomeConfigRules.canSave(0))
        assertTrue(HomeConfigRules.canSave(19))
        assertFalse(HomeConfigRules.canSave(20))
        assertFalse(HomeConfigRules.canSave(21))
        assertFalse(HomeConfigRules.canSave(-1))
    }

    @Test fun acceptsLegacyAndCurrentSchemasButRejectsFutureSchema() {
        assertEquals(3, HomeConfigRules.CURRENT_SCHEMA_VERSION)
        assertTrue(HomeConfigRules.canReadSchema(0))
        assertTrue(HomeConfigRules.canReadSchema(1))
        assertTrue(HomeConfigRules.canReadSchema(2))
        assertTrue(HomeConfigRules.canReadSchema(3))
        assertFalse(HomeConfigRules.canReadSchema(4))
        assertFalse(HomeConfigRules.canReadSchema(-1))
    }
}
