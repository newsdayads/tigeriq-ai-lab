package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    private val sha = "A".repeat(64)

    @Test fun acceptsOnlyHttpsUrlsWithoutEmbeddedCredentials() {
        assertTrue(UpdateRules.isSecureHttpsUrl("https://example.com/version.json"))
        assertFalse(UpdateRules.isSecureHttpsUrl("http://example.com/version.json"))
        assertFalse(UpdateRules.isSecureHttpsUrl("https://user:pass@example.com/version.json"))
        assertFalse(UpdateRules.isSecureHttpsUrl("not-a-url"))
    }

    @Test fun validatesCanonicalMetadataShape() {
        assertNotNull(
            UpdateRules.validateMetadata(
                10L,
                "2.0.0-test.10",
                "https://example.com/app.apk",
                sha,
                "Release notes",
                false,
            ),
        )
    }

    @Test fun rejectsUnsafeOrIncompleteMetadata() {
        assertNull(UpdateRules.validateMetadata(0L, "2.0", "https://example.com/app.apk", sha, "", false))
        assertNull(UpdateRules.validateMetadata(10L, "", "https://example.com/app.apk", sha, "", false))
        assertNull(UpdateRules.validateMetadata(10L, "2.0", "http://example.com/app.apk", sha, "", false))
        assertNull(UpdateRules.validateMetadata(10L, "2.0", "https://example.com/app.apk", "1234", "", false))
    }

    @Test fun matchesOnlyWellFormedExpectedSha256() {
        assertTrue(UpdateRules.matchesExpectedSha256("A".repeat(64), "a".repeat(64)))
        assertFalse(UpdateRules.matchesExpectedSha256("A".repeat(64), "B".repeat(64)))
        assertFalse(UpdateRules.matchesExpectedSha256("1234", "1234"))
        assertFalse(UpdateRules.matchesExpectedSha256("A".repeat(64), "1234"))
    }

    @Test fun comparesVersionCodesWithoutTreatingEqualAsUpdate() {
        val metadata = UpdateRules.validateMetadata(
            10L,
            "2.0.0-test.10",
            "https://example.com/app.apk",
            sha,
            "",
            false,
        )!!
        assertTrue(UpdateRules.hasNewerVersion(9L, metadata))
        assertFalse(UpdateRules.hasNewerVersion(10L, metadata))
        assertFalse(UpdateRules.hasNewerVersion(11L, metadata))
    }
}
