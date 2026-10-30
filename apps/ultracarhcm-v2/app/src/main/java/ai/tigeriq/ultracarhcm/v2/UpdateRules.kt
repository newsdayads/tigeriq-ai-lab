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

    fun validateJsonMetadataScalars(
        latestVersionCode: Any?,
        latestVersionName: Any?,
        apkUrl: Any?,
        sha256: Any?,
        releaseNotes: Any?,
        mandatory: Any?,
    ): UpdateMetadata? {
        val versionCode = when (latestVersionCode) {
            is Int -> latestVersionCode.toLong()
            is Long -> latestVersionCode
            else -> return null
        }
        val versionName = latestVersionName as? String ?: return null
        val url = apkUrl as? String ?: return null
        val sha = sha256 as? String ?: return null
        val notes = when (releaseNotes) {
            null -> ""
            is String -> releaseNotes
            else -> return null
        }
        val mandatoryFlag = when (mandatory) {
            null -> false
            is Boolean -> mandatory
            else -> return null
        }
        return validateMetadata(
            latestVersionCode = versionCode,
            latestVersionName = versionName,
            apkUrl = url,
            sha256 = sha,
            releaseNotes = notes,
            mandatory = mandatoryFlag,
        )
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
