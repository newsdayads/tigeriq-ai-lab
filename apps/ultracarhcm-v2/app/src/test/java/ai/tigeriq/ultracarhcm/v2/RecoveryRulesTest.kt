package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecoveryRulesTest {
    @Test fun rendersUppercaseHexDigest() {
        assertEquals("000FA5FF", RecoveryRules.hex(byteArrayOf(0x00, 0x0F, 0xA5.toByte(), 0xFF.toByte())))
    }

    @Test fun formatsCurrentSignerFingerprintsDeterministically() {
        assertEquals(
            "000F\nA5FF",
            RecoveryRules.formatSigningSha256(
                listOf(
                    byteArrayOf(0xA5.toByte(), 0xFF.toByte()),
                    byteArrayOf(0x00, 0x0F),
                    byteArrayOf(0xA5.toByte(), 0xFF.toByte()),
                ),
            ),
        )
        assertEquals(null, RecoveryRules.formatSigningSha256(emptyList()))
    }

    @Test fun acceptsOnlyDedicatedV2Package() {
        assertTrue(RecoveryRules.isExpectedPackageName("ai.tigeriq.ultracarhcm.v2"))
        assertFalse(RecoveryRules.isExpectedPackageName("ai.tigeriq.ultracarhcm"))
    }

    @Test fun rendersInstalledVersionLabel() {
        assertEquals("2.0.0-dev.9 (build 9)", RecoveryRules.versionLabel(" 2.0.0-dev.9 ", 9L))
        assertEquals("không rõ (build 0)", RecoveryRules.versionLabel(null, 0L))
    }

    @Test fun rollbackBoundaryRequiresVerifiedInputs() {
        assertTrue(RecoveryRules.rollbackBoundaryText().contains("APK V2 đã xác minh"))
        assertTrue(RecoveryRules.rollbackBoundaryText().contains("tuyến cài đặt thiết bị được phép"))
    }
}
