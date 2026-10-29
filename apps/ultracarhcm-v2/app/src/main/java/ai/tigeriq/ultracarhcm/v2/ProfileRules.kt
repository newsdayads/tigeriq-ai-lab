package ai.tigeriq.ultracarhcm.v2

internal object ProfileRules {
    const val MAX_DISPLAY_NAME = 60

    fun normalizeDisplayName(raw: String): String =
        raw.trim()
            .replace(Regex("\\s+"), " ")
            .take(MAX_DISPLAY_NAME)

    fun versionLabel(versionName: String?, versionCode: Long): String {
        val safeName = versionName?.trim().orEmpty().ifEmpty { "unknown" }
        return "UltraCarHCM V2 $safeName (build $versionCode)"
    }
}
