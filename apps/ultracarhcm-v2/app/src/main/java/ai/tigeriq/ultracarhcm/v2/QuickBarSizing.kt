package ai.tigeriq.ultracarhcm.v2

/** Compact three-row cockpit sizing; the outer Home geometry remains unchanged. */
internal data class QuickBarSizing(
    val rowGapDp: Float,
    val verticalPaddingDp: Float,
    val iconDp: Float,
    val fontSp: Float,
) {
    companion object {
        fun forHeight(heightDp: Float, fontScale: Float): QuickBarSizing {
            val height = if (heightDp.isFinite()) heightDp.coerceAtLeast(0f) else 0f
            val scale = if (fontScale.isFinite() && fontScale > 0f) fontScale else 1f
            val gap = minOf(6f, height / 24f)
            val row = (height - 2f * gap) / 3f
            val padding = minOf(2f, row / 12f)
            // Reserve a dp for fractional-pixel rounding at the row boundaries.
            val content = (row - 2f * padding - 1f).coerceAtLeast(0f)
            return QuickBarSizing(
                rowGapDp = gap,
                verticalPaddingDp = padding,
                iconDp = minOf(18f, content),
                fontSp = minOf(11f, content / (1.35f * scale)),
            )
        }
    }
}
