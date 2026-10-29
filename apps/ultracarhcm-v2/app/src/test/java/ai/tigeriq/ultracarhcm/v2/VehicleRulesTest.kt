package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Test

class VehicleRulesTest {
    @Test fun preservesLegacyLimoChoiceWhenModelKeyMissing() {
        assertEquals(
            VehicleRules.MODEL_LIMO_RED,
            VehicleRules.currentModel(null, true),
        )
        assertEquals(
            VehicleRules.MODEL_LAMBORGHINI_WHITE,
            VehicleRules.currentModel(null, false),
        )
    }

    @Test fun validatesSupportedVehicleModels() {
        org.junit.Assert.assertTrue(VehicleRules.isSupportedModel(VehicleRules.MODEL_LIMO_RED))
        org.junit.Assert.assertTrue(VehicleRules.isSupportedModel(VehicleRules.MODEL_LAMBORGHINI_WHITE))
        org.junit.Assert.assertFalse(VehicleRules.isSupportedModel("unknown"))
    }

    @Test fun explicitModelOverridesLegacyBoolean() {
        assertEquals(
            VehicleRules.MODEL_LAMBORGHINI_WHITE,
            VehicleRules.currentModel(VehicleRules.MODEL_LAMBORGHINI_WHITE, true),
        )
    }

    @Test fun normalizesAndBoundsLicensePlateText() {
        assertEquals("51K-123.45", VehicleRules.normalizeLicensePlate("  51k-123.45  "))
        assertEquals(
            VehicleRules.MAX_LICENSE_PLATE_LENGTH,
            VehicleRules.normalizeLicensePlate("x".repeat(40)).length,
        )
    }
}
