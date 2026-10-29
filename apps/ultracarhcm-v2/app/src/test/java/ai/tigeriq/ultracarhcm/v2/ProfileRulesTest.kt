package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileRulesTest {
    @Test fun normalizesWhitespaceAndTrimsDisplayName() {
        assertEquals("Nguyễn Trường Sơn", ProfileRules.normalizeDisplayName("  Nguyễn   Trường   Sơn  "))
    }

    @Test fun boundsDisplayNameLength() {
        val value = "x".repeat(ProfileRules.MAX_DISPLAY_NAME + 20)
        assertEquals(ProfileRules.MAX_DISPLAY_NAME, ProfileRules.normalizeDisplayName(value).length)
    }

    @Test fun formatsRuntimeVersionWithoutInventingLicenseState() {
        assertEquals(
            "UltraCarHCM V2 2.0.0-dev.9 (build 9)",
            ProfileRules.versionLabel("2.0.0-dev.9", 9L),
        )
        assertEquals("UltraCarHCM V2 unknown (build 0)", ProfileRules.versionLabel(" ", 0L))
    }
}
