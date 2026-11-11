package ai.tigeriq.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class MotionSteeringEstimatorTest {

    @Test
    fun stationaryMemsBiasDrift_adaptsOutToZero() {
        val estimator = MotionSteeringEstimator()
        var t = 1000L
        for (i in 0..80) {
            estimator.onGyroSample(0f, 0.016f, 0f, 0f, 9.81f, 0f, true, t)
            val deg = estimator.step(t, inverted = false)
            assertEquals("Tiny constant bias must not bend guidelines", 0f, deg, 0.01f)
            t += 30L
        }
    }

    @Test
    fun idleEngineVibration_andMountShake_areRejectedToZero() {
        val estimator = MotionSteeringEstimator()
        var t = 1000L
        // Alternating +/- high vibration while camera image is static
        for (i in 0..50) {
            val spike = if (i % 2 == 0) 0.22f else -0.22f
            estimator.onVideoMotionScore(0.3f, t)
            estimator.onGyroSample(0f, spike, 0f, 0f, 9.81f, 0f, true, t)
            val deg = estimator.step(t, inverted = false)
            assertTrue("Alternating vibration caused false curve: $deg", abs(deg) < 0.5f)
            t += 25L
        }
    }

    @Test
    fun pedestrianCrossingBehindParkedCar_withoutGyro_keepsLinesStraight() {
        val estimator = MotionSteeringEstimator()
        var t = 2000L
        for (i in 0..30) {
            estimator.onVideoMotionScore(18.0f, t)
            estimator.onGyroSample(0f, 0.002f, 0f, 0f, 9.81f, 0f, true, t)
            val deg = estimator.step(t, inverted = false)
            assertEquals(0f, deg, 0.01f)
            t += 30L
        }
    }

    @Test
    fun briefTapBumpOnStaticScene_isRejected() {
        val estimator = MotionSteeringEstimator()
        var t = 3000L
        estimator.onVideoMotionScore(0.2f, t)
        estimator.onGyroSample(0f, -0.14f, 0f, 0f, 9.81f, 0f, true, t)
        assertEquals(0f, estimator.step(t, inverted = false), 0.01f)
        t += 40L
        estimator.onGyroSample(0f, 0.0f, 0f, 0f, 9.81f, 0f, true, t)
        assertEquals(0f, estimator.step(t, inverted = false), 0.01f)
    }

    @Test
    fun sustainedReverseTurn_curvesSmoothly_respectsInvert_andDecaysWhenStraight() {
        val estimator = MotionSteeringEstimator()
        var t = 4000L
        var peakNormal = 0f
        for (i in 0..25) {
            estimator.onVideoMotionScore(7.5f, t)
            // Negative yaw around +gravity up axis -> positive right curvature before invert
            estimator.onGyroSample(0f, -0.24f, 0f, 0f, 9.81f, 0f, true, t)
            val deg = estimator.step(t, inverted = false)
            if (abs(deg) > abs(peakNormal)) peakNormal = deg
            t += 33L
        }
        assertTrue("Expected noticeable reverse curve (>= 15 deg), got $peakNormal", peakNormal >= 15f)
        assertTrue("Expected clamped within 35 deg, got $peakNormal", peakNormal <= 35f)

        val invertedDeg = estimator.step(t, inverted = true)
        assertTrue("Invert switch must flip steering direction", invertedDeg < 0f)

        // Straighten wheel: yaw returns to 0 and settles smoothly back to center
        for (i in 0..30) {
            estimator.onGyroSample(0f, 0f, 0f, 0f, 9.81f, 0f, true, t)
            estimator.step(t, inverted = false)
            t += 33L
        }
        assertEquals("Guidelines must return smoothly to straight center", 0f, estimator.step(t, inverted = false), 0.5f)
    }

    @Test
    fun steeringResolver_prioritizesVerifiedAngle_andIgnoresZeroBroadcastReset() {
        val resolver = GuideSteeringResolver()
        // Zero legacy broadcast must not suppress motion fallback
        resolver.setLegacySteeringDegrees(0f, inverted = false)
        assertEquals(14f, resolver.resolveTargetDegrees(motionDegrees = 14f), 0.01f)

        // Explicit non-zero broadcast works
        resolver.setLegacySteeringDegrees(225f, inverted = false)
        assertEquals(15f, resolver.resolveTargetDegrees(motionDegrees = 5f), 0.01f)

        // Verified road-wheel angle strictly wins over both
        resolver.setVerifiedRoadWheelAngleDegrees(-28f)
        assertEquals(-28f, resolver.resolveTargetDegrees(motionDegrees = 14f), 0.01f)
    }
}
