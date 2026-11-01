package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    private val sha = "A".repeat(64)
    private val releaseUrl =
        "https://github.com/newsdayads/tigeriq-ai-lab/releases/download/ultracarhcm-v2-test.12/app.apk"

    @Test fun acceptsOnlyHttpsUrlsWithoutEmbeddedCredentials() {
        assertTrue(UpdateRules.isSecureHttpsUrl("https://example.com/version.json"))
        assertFalse(UpdateRules.isSecureHttpsUrl("http://example.com/version.json"))
        assertFalse(UpdateRules.isSecureHttpsUrl("https://user:pass@example.com/version.json"))
        assertFalse(UpdateRules.isSecureHttpsUrl("not-a-url"))
    }

    @Test fun acceptsOnlyTrustedV2PayloadRedirectChain() {
        assertTrue(UpdateRules.isTrustedV2PayloadUrl(releaseUrl))
        assertTrue(
            UpdateRules.isTrustedV2PayloadUrl(
                "https://release-assets.githubusercontent.com/github-production-release-asset/test.apk?sp=r&sig=abc",
            ),
        )
        assertTrue(
            UpdateRules.isTrustedV2PayloadUrl(
                "https://objects.githubusercontent.com/github-production-release-asset/test.apk?sig=abc",
            ),
        )
        assertFalse(UpdateRules.isTrustedV2PayloadUrl("https://github.com/newsdayads/tigeriq-ai-lab/archive/main.zip"))
        assertFalse(UpdateRules.isTrustedV2PayloadUrl("https://example.com/app.apk"))
        assertFalse(UpdateRules.isTrustedV2PayloadUrl("http://release-assets.githubusercontent.com/app.apk"))
        assertFalse(UpdateRules.isTrustedV2PayloadUrl("https://user:pass@release-assets.githubusercontent.com/app.apk"))
        assertFalse(UpdateRules.isTrustedV2PayloadUrl("https://release-assets.githubusercontent.com/app.apk#fragment"))
    }

    @Test fun validatesTrustedReleaseMetadataShape() {
        assertNotNull(
            UpdateRules.validateMetadata(
                12L,
                "2.0.0-test.12",
                true,
                releaseUrl,
                sha,
                "Release notes",
                false,
            ),
        )
    }

    @Test fun validatesExplicitNoReleaseMetadataShape() {
        assertNotNull(
            UpdateRules.validateMetadata(
                11L,
                "2.0.0-dev.11",
                false,
                "",
                "",
                "No signed V2 TEST release yet",
                false,
            ),
        )
    }

    @Test fun rejectsUnsafeOrIncompleteReleaseMetadata() {
        assertNull(UpdateRules.validateMetadata(0L, "2.0", true, releaseUrl, sha, "", false))
        assertNull(UpdateRules.validateMetadata(12L, "", true, releaseUrl, sha, "", false))
        assertNull(UpdateRules.validateMetadata(12L, "2.0", true, "http://example.com/app.apk", sha, "", false))
        assertNull(UpdateRules.validateMetadata(12L, "2.0", true, "https://example.com/app.apk", sha, "", false))
        assertNull(UpdateRules.validateMetadata(12L, "2.0", true, releaseUrl, "1234", "", false))
        assertNull(UpdateRules.validateMetadata(11L, "2.0", false, releaseUrl, sha, "", false))
        assertNull(UpdateRules.validateMetadata(11L, "2.0", false, "", "", "", true))
    }

    @Test fun acceptsOnlyExactJsonScalarTypes() {
        assertNotNull(
            UpdateRules.validateJsonMetadataScalars(
                11,
                "2.0.0-dev.11",
                false,
                null,
                null,
                null,
                null,
            ),
        )
        assertNotNull(
            UpdateRules.validateJsonMetadataScalars(
                12L,
                "2.0.0-test.12",
                true,
                releaseUrl,
                sha,
                "Notes",
                false,
            ),
        )
    }

    @Test fun rejectsJsonScalarTypeCoercion() {
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                "12",
                "2.0.0-test.12",
                true,
                releaseUrl,
                sha,
                "",
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12.0,
                "2.0.0-test.12",
                true,
                releaseUrl,
                sha,
                "",
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12,
                200,
                true,
                releaseUrl,
                sha,
                "",
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12,
                "2.0.0-test.12",
                "true",
                releaseUrl,
                sha,
                "",
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12,
                "2.0.0-test.12",
                true,
                123,
                sha,
                "",
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12,
                "2.0.0-test.12",
                true,
                releaseUrl,
                123,
                "",
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12,
                "2.0.0-test.12",
                true,
                releaseUrl,
                sha,
                123,
                false,
            ),
        )
        assertNull(
            UpdateRules.validateJsonMetadataScalars(
                12,
                "2.0.0-test.12",
                true,
                releaseUrl,
                sha,
                "",
                "false",
            ),
        )
    }

    @Test fun matchesOnlyWellFormedExpectedSha256() {
        assertTrue(UpdateRules.matchesExpectedSha256("A".repeat(64), "a".repeat(64)))
        assertFalse(UpdateRules.matchesExpectedSha256("A".repeat(64), "B".repeat(64)))
        assertFalse(UpdateRules.matchesExpectedSha256("1234", "1234"))
        assertFalse(UpdateRules.matchesExpectedSha256("A".repeat(64), "1234"))
    }

    @Test fun matchesPinnedSignerFingerprintOnlyWhenWellFormedAndEqual() {
        assertTrue(UpdateRules.matchesPinnedSignerSha256("A".repeat(64), "a".repeat(64)))
        assertFalse(UpdateRules.matchesPinnedSignerSha256("A".repeat(64), "B".repeat(64)))
        assertFalse(UpdateRules.matchesPinnedSignerSha256("not-a-cert", "not-a-cert"))
    }

    @Test fun matchesVersionNameExactlyWithoutCoercion() {
        assertTrue(UpdateRules.matchesExpectedVersionName("2.0.0-test.12", "2.0.0-test.12"))
        assertFalse(UpdateRules.matchesExpectedVersionName("2.0.0-test.12", "2.0.0-Test.12"))
        assertFalse(UpdateRules.matchesExpectedVersionName("2.0.0-test.12", " 2.0.0-test.12 "))
        assertFalse(UpdateRules.matchesExpectedVersionName("2.0.0-test.12", null))
        assertFalse(UpdateRules.matchesExpectedVersionName("", ""))
    }

    @Test fun comparesVersionCodesOnlyWhenReleaseIsAvailable() {
        val release = UpdateRules.validateMetadata(
            12L,
            "2.0.0-test.12",
            true,
            releaseUrl,
            sha,
            "",
            false,
        )!!
        assertTrue(UpdateRules.hasNewerVersion(11L, release))
        assertFalse(UpdateRules.hasNewerVersion(12L, release))
        assertFalse(UpdateRules.hasNewerVersion(13L, release))

        val noRelease = UpdateRules.validateMetadata(
            13L,
            "2.0.0-dev.13",
            false,
            "",
            "",
            "",
            false,
        )!!
        assertFalse(UpdateRules.hasNewerVersion(11L, noRelease))
    }
}
