package ai.tigeriq.ultracarhcm.v2

internal data class OverlayPosition(val x: Int, val y: Int)

internal object OverlayPositionRules {
    const val DEFAULT_X = 32
    const val DEFAULT_Y = 200

    fun xKey(displayId: Int): String = "display_${displayId}_x"
    fun yKey(displayId: Int): String = "display_${displayId}_y"

    fun clamp(x: Int, y: Int, displayWidth: Int, displayHeight: Int, size: Int): OverlayPosition {
        val maxX = maxOf(0, displayWidth - size)
        val maxY = maxOf(0, displayHeight - size)
        return OverlayPosition(
            x = x.coerceIn(0, maxX),
            y = y.coerceIn(0, maxY),
        )
    }
}
