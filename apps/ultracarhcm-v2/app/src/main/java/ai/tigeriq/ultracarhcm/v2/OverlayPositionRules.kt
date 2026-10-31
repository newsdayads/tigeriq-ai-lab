package ai.tigeriq.ultracarhcm.v2

internal data class OverlayPosition(val x: Int, val y: Int)

internal object OverlayPositionRules {
    const val DEFAULT_X = 32
    const val DEFAULT_Y = 200
    const val PORTABLE_X_KEY = "portable_x"
    const val PORTABLE_Y_KEY = "portable_y"

    fun xKey(displayId: Int): String = "display_${displayId}_x"
    fun yKey(displayId: Int): String = "display_${displayId}_y"

    fun restoredCoordinate(
        displaySpecific: Int?,
        portable: Int?,
        legacy: Int?,
        defaultValue: Int,
    ): Int = displaySpecific ?: portable ?: legacy ?: defaultValue

    fun clamp(x: Int, y: Int, displayWidth: Int, displayHeight: Int, size: Int): OverlayPosition {
        val maxX = maxOf(0, displayWidth - size)
        val maxY = maxOf(0, displayHeight - size)
        return OverlayPosition(
            x = x.coerceIn(0, maxX),
            y = y.coerceIn(0, maxY),
        )
    }
}
