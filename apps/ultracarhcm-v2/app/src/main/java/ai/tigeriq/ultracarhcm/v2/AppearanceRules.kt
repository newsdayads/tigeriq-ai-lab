package ai.tigeriq.ultracarhcm.v2

internal object AppearanceRules {
    const val PREF_CUSTOM_BACKGROUND_URI = "v2_custom_background_uri"
    const val PREF_CUSTOM_BACKGROUND_KIND = "v2_custom_background_kind"
    const val KIND_IMAGE = "image"
    const val KIND_VIDEO = "video"

    fun kindForMime(mimeType: String?): String? = when {
        mimeType?.startsWith("image/", ignoreCase = true) == true -> KIND_IMAGE
        mimeType?.startsWith("video/", ignoreCase = true) == true -> KIND_VIDEO
        else -> null
    }

    fun isSupportedKind(kind: String?): Boolean =
        kind == KIND_IMAGE || kind == KIND_VIDEO

    fun modeLabel(night: Boolean): String =
        if (night) "Ban đêm" else "Ban ngày"
}
