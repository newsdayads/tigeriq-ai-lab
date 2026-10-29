package ai.tigeriq.ultracarhcm.v2

internal object ProfileLayoutRules {
    const val MEDIUM_WIDTH_DP = 600
    const val WIDE_WIDTH_DP = 960

    fun columnsForWidthDp(widthDp: Int): Int = when {
        widthDp >= WIDE_WIDTH_DP -> 3
        widthDp >= MEDIUM_WIDTH_DP -> 2
        else -> 1
    }
}
