package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.*
import org.junit.Test

class GuideStyleRulesTest {
    @Test fun exposesExactlyThreeOwnerObservedStyles() {
        assertEquals(
            listOf("Sport Racing", "Luxury OEM", "Minimalist Modern"),
            GuideStyle.values().map { it.title },
        )
        assertEquals(GuideStyle.SPORT_RACING, GuideStyleRules.parse(null))
        assertEquals(GuideStyle.SPORT_RACING, GuideStyleRules.parse("invalid"))
        assertEquals(GuideStyle.LUXURY_OEM, GuideStyleRules.parse("LUXURY_OEM"))
    }

    @Test fun palettesAreDistinctAndCameraGuidesRemainVisibleAcrossStyles() {
        val sport = GuideStyleRules.palette(GuideStyle.SPORT_RACING)
        val luxury = GuideStyleRules.palette(GuideStyle.LUXURY_OEM)
        val minimal = GuideStyleRules.palette(GuideStyle.MINIMALIST_MODERN)
        assertTrue(sport.boundaryWidthDp > luxury.boundaryWidthDp)
        assertTrue(luxury.boundaryWidthDp > minimal.boundaryWidthDp)
        assertEquals(minimal.nearColor, minimal.middleColor)
        assertEquals(minimal.middleColor, minimal.farColor)
        assertTrue(sport.boundaryAlpha in 1..255)
        assertTrue(minimal.boundaryAlpha in 1..255)
        assertEquals(3, GuideTrackModel.distanceMarkers.size)
    }

    @Test fun invalidSteeringWarpAndProgressNeverReachCanvasAsNan() {
        val inputs = listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)
        for (value in inputs) {
            val normalized = GuideTrackModel.normalize(
                GuideCurveState(reverseActive = true, steeringDegrees = value, warp = value),
            )
            assertEquals(0f, normalized.steeringDegrees, 0.0001f)
            assertEquals(1f, normalized.warp, 0.0001f)
            for (side in listOf(-1, 1)) {
                val point = GuideTrackModel.trackPoint(value, side, normalized)
                assertTrue(point.x.isFinite())
                assertTrue(point.y.isFinite())
                assertTrue(point.x in 0f..1f)
                assertTrue(point.y in 0f..1f)
            }
        }
    }
}
