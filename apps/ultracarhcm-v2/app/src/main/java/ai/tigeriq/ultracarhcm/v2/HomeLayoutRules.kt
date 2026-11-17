package ai.tigeriq.ultracarhcm.v2

internal object HomeLayoutRules {
    const val NARROW_DEX_MAX_WIDTH_DP = 520
    const val NARROW_DEX_MIN_HEIGHT_DP = 600

    /**
     * Owner Drive evidence (IMG_7926.MOV) shows UltraCar living as a tall,
     * narrow DeX split-window beside Maps / reverse camera. Keep this source
     * rule local to V2 HOME; it must never imply control of another app window.
     */
    /**
     * On a 16:9 external screen the three-row QuickBar begins around 0.56–0.69
     * of the height. Reserve a real vertical gap for the parked car artwork so
     * the nine editable buttons never mask the car or its license plate.
     */
    fun vehicleTopBeforeQuickBar(quickBarTop: Float): Float {
        val safeBarTop = (quickBarTop.takeIf { it.isFinite() } ?: .56f)
            .coerceIn(.56f, .80f)
        return (safeBarTop - .225f - .018f).coerceIn(.28f, .50f)
    }

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
