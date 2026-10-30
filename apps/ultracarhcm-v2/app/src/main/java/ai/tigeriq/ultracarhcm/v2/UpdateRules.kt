package ai.tigeriq.ultracarhcm.v2

import java.net.URI

internal data class UpdateMetadata(
    val latestVersionCode: Long,
    val latestVersionName: String,
    val apkUrl: String,
    val sha256: String,
    val releaseNotes: String,
    val mandatory: Boolean,
)

internal object UpdateRules {
    private val sha256Pattern = Regex("^[A-Fa-f0-9]{64}$")

    fun isSecureHttpsUrl(raw: String): Boolean = try {
        val uri = URI(raw.trim())
        uri.scheme.equals("https", ignoreCase = true) &&
            !uri.host.isNullOrBlank() &&
            uri.userInfo == null
    } catch (_: Exception) {
        false
    }

    fun validateMetadata(
        latestVersionCode: Long,
        latestVersionName: String,
        apkUrl: String,
        sha256: String,
        releaseNotes: String,
        mandatory: Boolean,
    ): UpdateMetadata? {
        val safeName = latestVersionName.trim()
        val safeUrl = apkUrl.trim()
        val safeSha = sha256.trim()
        val safeNotes = releaseNotes.trim()
        if (latestVersionCode <= 0L) return null
        if (safeName.isEmpty() || safeName.length > 120) return null
        if (!isSecureHttpsUrl(safeUrl)) return null
        if (!sha256Pattern.matches(safeSha)) return null
        if (safeNotes.length > 10_000) return null
        return UpdateMetadata(
            latestVersionCode = latestVersionCode,
            latestVersionName = safeName,
            apkUrl = safeUrl,
            sha256 = safeSha.uppercase(),
            releaseNotes = safeNotes,
            mandatory = mandatory,
        )
    }

    fun matchesExpectedSha256(expectedSha256: String, observedSha256: String): Boolean {
        val expected = expectedSha256.trim()
        val observed = observedSha256.trim()
        if (!sha256Pattern.matches(expected) || !sha256Pattern.matches(observed)) return false
        return expected.equals(observed, ignoreCase = true)
    }

    fun hasNewerVersion(currentVersionCode: Long, metadata: UpdateMetadata): Boolean =
        metadata.latestVersionCode > currentVersionCode
}
