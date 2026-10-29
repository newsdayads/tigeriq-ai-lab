package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GuideTrackModelTest {
    @Test
    fun clampsSteeringAndWarpToSafeSourceBounds() {
        val normalized = GuideTrackModel.normalize(
            GuideCurveState(reverseActive = true, steeringDegrees = 99f, warp = 5f),
        )
        assertEquals(35f, normalized.steeringDegrees, 0.0001f)
        assertEquals(1.35f, normalized.warp, 0.0001f)
    }

    @Test
    fun straightGuideRemainsSymmetricAroundCameraCenter() {
        val state = GuideCurveState(reverseActive = true, steeringDegrees = 0f)
        for (progress in listOf(0f, 0.25f, 0.5f, 0.75f, 1f)) {
            val left = GuideTrackModel.trackPoint(progress, -1, state)
            val right = GuideTrackModel.trackPoint(progress, 1, state)
            assertEquals(1f, left.x + right.x, 0.0001f)
            assertEquals(left.y, right.y, 0.0001f)
        }
    }

    @Test
    fun steeringBendsBothTrackEdgesInSameDirectionProgressively() {
        val straight = GuideCurveState(reverseActive = true, steeringDegrees = 0f)
        val rightTurn = GuideCurveState(reverseActive = true, steeringDegrees = 25f)

        val straightNear = GuideTrackModel.trackPoint(0.2f, -1, straight)
        val curvedNear = GuideTrackModel.trackPoint(0.2f, -1, rightTurn)
        val straightFar = GuideTrackModel.trackPoint(0.9f, -1, straight)
        val curvedFar = GuideTrackModel.trackPoint(0.9f, -1, rightTurn)

        val nearShift = curvedNear.x - straightNear.x
        val farShift = curvedFar.x - straightFar.x
        assertTrue(nearShift > 0f)
        assertTrue(farShift > nearShift)
    }

    @Test
    fun perspectiveNarrowsTowardHorizon() {
        val state = GuideCurveState(reverseActive = true)
        val bottom = GuideTrackModel.crossbar(0f, state)
        val horizon = GuideTrackModel.crossbar(1f, state)
        val bottomWidth = bottom.second.x - bottom.first.x
        val horizonWidth = horizon.second.x - horizon.first.x
        assertTrue(bottomWidth > horizonWidth)
    }
    @Test
    fun preservesObservedV1DistanceLabelOrderWithoutClaimingCalibration() {
        assertEquals(
            listOf("1.5m", "1.0m", "0.5m"),
            GuideTrackModel.distanceMarkers.map { it.label },
        )
        assertEquals(
            listOf(0.72f, 0.48f, 0.22f),
            GuideTrackModel.distanceMarkers.map { it.progress },
        )
    }

}
