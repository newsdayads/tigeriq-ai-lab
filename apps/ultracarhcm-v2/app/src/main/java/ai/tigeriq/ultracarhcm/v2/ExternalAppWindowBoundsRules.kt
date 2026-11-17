package ai.tigeriq.ultracarhcm.v2

import kotlin.math.roundToInt

/**
 * Requested right-hand external-app region beside the narrow DeX Home panel.
 * Android/OEM may reject, resize or override ActivityOptions.launchBounds.
 * No task/window of another package is ever forcibly moved or resized.
 */
internal data class ExternalAppWindowBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
}

internal object ExternalAppWindowBoundsRules {
    fun initial(
        displayWidth: Int,
        displayHeight: Int,
        displayDensity: Float,
    ): ExternalAppWindowBounds? {
        if (displayWidth < 800 || displayHeight < 550 ||
            !displayDensity.isFinite() || displayDensity <= 0f || displayDensity > 10f
        ) return null

        // Reserve the left ~36% for the V1-evidenced tall UltraCar split panel.
        val left = (displayWidth * .36f).roundToInt()
        val rightMargin = (16f * displayDensity).roundToInt()
            .coerceIn(8, (displayWidth * .04f).roundToInt())
        val top = (24f * displayDensity).roundToInt()
            .coerceIn(16, (displayHeight * .08f).roundToInt())
        val bottomMargin = (16f * displayDensity).roundToInt()
            .coerceIn(8, (displayHeight * .06f).roundToInt())
        val right = displayWidth - rightMargin
        val bottom = displayHeight - bottomMargin
        if (right <= left || bottom <= top) return null

        return ExternalAppWindowBounds(left, top, right, bottom)
    }
}
