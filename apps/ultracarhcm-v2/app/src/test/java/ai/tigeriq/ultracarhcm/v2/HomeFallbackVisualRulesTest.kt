package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.*
import org.junit.Test

class HomeFallbackVisualRulesTest {
    @Test fun sceneGeometryAlwaysFitsExpectedFractions() {
        assertEquals(.49f, HomeFallbackVisualRules.SKYLINE_HORIZON, .0001f)
        assertTrue(HomeFallbackVisualRules.ROAD_BOTTOM > 1f)
        for (i in -100..100) {
            val height = HomeFallbackVisualRules.buildingHeight(i)
            assertTrue("Invalid city silhouette height at $i", height in .05f.. .25f)
        }
    }

    @Test fun impossibleFractionValuesMustNotEscalateToCanvasGeometry() {
        assertEquals(0f, HomeFallbackVisualRules.fraction(Float.NaN), 0f)
        assertEquals(0f, HomeFallbackVisualRules.fraction(Float.NEGATIVE_INFINITY), 0f)
        assertEquals(0f, HomeFallbackVisualRules.fraction(-2f), 0f)
        assertEquals(1f, HomeFallbackVisualRules.fraction(Float.POSITIVE_INFINITY), 0f)
        assertEquals(1f, HomeFallbackVisualRules.fraction(20f), 0f)
    }
}
