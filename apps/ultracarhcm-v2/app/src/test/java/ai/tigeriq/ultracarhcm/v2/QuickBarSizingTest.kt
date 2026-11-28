package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.*
import org.junit.Test

class QuickBarSizingTest {
    @Test fun compactRowsFitIconAndScaledText() {
        // Real emulator: 97px QuickBar at 320dpi, versus 99px at 160dpi.
        for (height in listOf(48.5f, 49.5f, 97f, 99f, 151f, 300f)) {
            for (scale in listOf(0.85f, 1f, 1.3f, 2f)) {
                val s = QuickBarSizing.forHeight(height, scale)
                val content = (height - 2 * s.rowGapDp) / 3 - 2 * s.verticalPaddingDp
                assertTrue(s.iconDp > 0f && s.iconDp <= content)
                assertTrue(s.fontSp > 0f && s.fontSp * scale * 1.2f <= content)
                assertTrue(s.rowGapDp <= 6f && s.verticalPaddingDp <= 2f)
            }
        }
    }

    @Test fun roomyRowsPreserveOriginalSizes() {
        val s = QuickBarSizing.forHeight(151f, 1f)
        assertEquals(6f, s.rowGapDp, 0f)
        assertEquals(2f, s.verticalPaddingDp, 0f)
        assertEquals(18f, s.iconDp, 0f)
        assertEquals(11f, s.fontSp, 0f)
    }

    @Test fun compactCaseReducesFixedSizes() {
        val s = QuickBarSizing.forHeight(48.5f, 1f)
        assertTrue(s.iconDp < 18f)
        assertTrue(s.fontSp < 11f)
    }
}
