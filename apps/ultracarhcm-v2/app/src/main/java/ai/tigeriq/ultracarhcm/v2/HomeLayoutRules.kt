package ai.tigeriq.ultracarhcm.v2

internal object HomeLayoutRules {
    const val NARROW_DEX_MAX_WIDTH_DP = 520
    const val NARROW_DEX_MIN_HEIGHT_DP = 600

    /**
     * Owner Drive evidence (IMG_7926.MOV) shows UltraCar living as a tall,
     * narrow DeX split-window beside Maps / reverse camera. Keep this source
     * rule local to V2 HOME; it must never imply control of another app window.
     */
    fun useNarrowDexPanel(
        widthPx: Int,
        heightPx: Int,
        density: Float,
        isDesktop: Boolean,
    ): Boolean {
        if (!isDesktop || widthPx <= 0 || heightPx <= 0 || density <= 0f) return false
        val widthDp = widthPx / density
        val heightDp = heightPx / density
        return widthDp <= NARROW_DEX_MAX_WIDTH_DP &&
            heightDp >= NARROW_DEX_MIN_HEIGHT_DP &&
            heightPx > widthPx
    }
}
