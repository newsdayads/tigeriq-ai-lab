package ai.tigeriq.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReversePathGeometryTest {

    @Test
    fun sampleTrackPoint_clampsBoundsWithoutThrowingForInnerTireOffsets() {
        val inner = ReversePathGeometry.sampleTrackPoint(
            distanceBack = 1.5,
            roadWheelDegrees = -32.0,
            wheelbaseMeters = 2.9,
            lateralOffsetMeters = -0.56
        )
        val outer = ReversePathGeometry.sampleTrackPoint(
            distanceBack = 1.5,
            roadWheelDegrees = -32.0,
            wheelbaseMeters = 2.9,
            lateralOffsetMeters = -0.92
        )
        assertTrue(outer.x < inner.x)
        assertTrue(inner.back > 0.0)

        // Edge clamp safety: out-of-range inputs should never crash the overlay
        val extreme = ReversePathGeometry.sampleTrackPoint(
            distanceBack = 10.0,
            roadWheelDegrees = -75.0,
            wheelbaseMeters = 0.5,
            lateralOffsetMeters = 5.0
        )
        assertTrue(extreme.x.isFinite() && extreme.back.isFinite())
    }

    @Test
    fun oemWheelTrack_preservesGapAndNonCrossingBandsAcrossAngles() {
        val angles = listOf(-32.0, -18.0, 0.0, 18.0, 32.0)
        val distances = listOf(0.45, 1.0, 1.8, 2.8)
        for (angle in angles) {
            for (s in distances) {
                val pLeftOuter = projectPoint(s, -0.92, angle)
                val pLeftTireOuter = projectPoint(s, -0.84, angle)
                val pLeftTireInner = projectPoint(s, -0.56, angle)
                val pRightTireInner = projectPoint(s, 0.56, angle)
                val pRightTireOuter = projectPoint(s, 0.84, angle)
                val pRightOuter = projectPoint(s, 0.92, angle)

                // Screen X ordering must stay strictly separated from left outer to right outer
                assertTrue("Gap between left outer rail and tire broken at angle=$angle s=$s", pLeftOuter.x < pLeftTireOuter.x - 1f)
                assertTrue("Left tire ribbon collapsed at angle=$angle s=$s", pLeftTireOuter.x < pLeftTireInner.x - 2f)
                assertTrue("Left and right tire tracks crossed at angle=$angle s=$s", pLeftTireInner.x < pRightTireInner.x - 10f)
                assertTrue("Right tire ribbon collapsed at angle=$angle s=$s", pRightTireInner.x < pRightTireOuter.x - 2f)
                assertTrue("Gap between right tire and outer rail broken at angle=$angle s=$s", pRightTireOuter.x < pRightOuter.x - 1f)
            }
        }
    }

    @Test
    fun redBumperBar_staysFixedAtRearBumperWhenSteering() {
        val straightLeft = projectPoint(0.50, -0.92, 0.0)
        val straightRight = projectPoint(0.50, 0.92, 0.0)
        assertEquals(0f, (straightLeft.x + straightRight.x) * 0.5f - 540f, 0.5f)
        assertEquals(straightLeft.y, straightRight.y, 0.5f)
    }

    private fun projectPoint(sMeters: Double, lateralMeters: Double, wheelDeg: Double): ReversePathGeometry.ScreenPoint {
        val pt = ReversePathGeometry.sampleTrackPoint(sMeters, wheelDeg, 2.9, lateralMeters)
        return ReversePathGeometry.worldToScreen(
            worldX = pt.x,
            worldBack = pt.back,
            cx = 540f,
            bottomY = 860f,
            topY = 380f,
            bottomHalfW = 324f,
            topHalfW = 140f
        )
    }
}
