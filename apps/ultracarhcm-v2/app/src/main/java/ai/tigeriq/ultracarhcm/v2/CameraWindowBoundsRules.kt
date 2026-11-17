package ai.tigeriq.ultracarhcm.v2

import kotlin.math.roundToInt

/** Window placement only: no pretend Samsung/freeform control on unsupported OEMs. */
internal data class CameraWindowBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
}

/** Convert actual DeX display metrics (not phone density) to bounded popup coordinates. */
internal object CameraWindowBoundsRules {
    fun initial(displayWidth: Int, displayHeight: Int, displayDensity: Float): CameraWindowBounds? {
        if (displayWidth < 800 || displayHeight < 550 ||
            !displayDensity.isFinite() || displayDensity <= 0f
        ) return null

        val width = minOf(
            (430f * displayDensity).roundToInt(),
            (displayWidth * 0.55f).roundToInt(),
        ).coerceAtLeast(320)
        val height = minOf(
            (width * 0.70f).roundToInt(),
            (displayHeight * 0.63f).roundToInt(),
        ).coerceAtLeast(200)
        if (width > displayWidth || height > displayHeight) return null
        val left = (20f * displayDensity).roundToInt().coerceIn(0, displayWidth - width)
        val top = (48f * displayDensity).roundToInt().coerceIn(0, displayHeight - height)
        return CameraWindowBounds(left, top, left + width, top + height)
    }
}
