package ai.tigeriq.ultracarhcm.v2

/**
 * Selectable visual guide styles reconstructed independently from Owner's
 * observed V1 controls. Pure display styling, NOT distance calibration.
 */
internal enum class GuideStyle(val title: String) {
    SPORT_RACING("Sport Racing"),
    LUXURY_OEM("Luxury OEM"),
    MINIMALIST_MODERN("Minimalist Modern"),
}

internal data class GuidePalette(
    val boundaryColor: Int,
    val nearColor: Int,
    val middleColor: Int,
    val farColor: Int,
    val boundaryWidthDp: Float,
    val crossbarWidthDp: Float,
    val labelScale: Float,
    val boundaryAlpha: Int,
)

internal object GuideStyleRules {
    const val PREFS = "v2_camera_visual_guide"
    const val PREF_STYLE = "style"
    val DEFAULT = GuideStyle.SPORT_RACING

    fun parse(raw: String?): GuideStyle =
        GuideStyle.values().firstOrNull { it.name == raw } ?: DEFAULT

    fun palette(style: GuideStyle): GuidePalette = when (style) {
        GuideStyle.SPORT_RACING -> GuidePalette(
            boundaryColor = 0xFFFFFFFF.toInt(),
            nearColor = 0xFFFF4141.toInt(),
            middleColor = 0xFFFFDB43.toInt(),
            farColor = 0xFF29E36E.toInt(),
            boundaryWidthDp = 3.5f,
            crossbarWidthDp = 3.5f,
            labelScale = 1.0f,
            boundaryAlpha = 235,
        )
        GuideStyle.LUXURY_OEM -> GuidePalette(
            boundaryColor = 0xFFE6EAF0.toInt(),
            nearColor = 0xFFF48272.toInt(),
            middleColor = 0xFFF2CF81.toInt(),
            farColor = 0xFFB4D8C2.toInt(),
            boundaryWidthDp = 2.5f,
            crossbarWidthDp = 2.5f,
            labelScale = 0.9f,
            boundaryAlpha = 215,
        )
        GuideStyle.MINIMALIST_MODERN -> GuidePalette(
            boundaryColor = 0xFF76D9EE.toInt(),
            nearColor = 0xFF76D9EE.toInt(),
            middleColor = 0xFF76D9EE.toInt(),
            farColor = 0xFF76D9EE.toInt(),
            boundaryWidthDp = 1.5f,
            crossbarWidthDp = 1.5f,
            labelScale = 0.85f,
            boundaryAlpha = 190,
        )
    }
}
