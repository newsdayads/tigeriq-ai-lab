package ai.tigeriq.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

class UvcMotionEvidenceTest {

    @Test
    fun computeRoadMotionScore_rejectsExposureShift_andDetectsTextureMotion() {
        val width = 64
        val height = 48
        val prev = ByteArray(UvcFrameSignalEvidence.ROAD_MOTION_GRID_SIZE)
        val curr = ByteArray(UvcFrameSignalEvidence.ROAD_MOTION_GRID_SIZE)

        val baseFrame = ByteArray(width * height + (width * height) / 2)
        for (y in 0 until height) {
            for (x in 0 until width) {
                baseFrame[y * width + x] = ((x * 5 + y * 3) % 160 + 20).toByte()
            }
        }

        val firstScore = UvcFrameSignalEvidence.computeRoadMotionScore(
            ByteBuffer.wrap(baseFrame), width, height, prev, curr
        )
        assertNotNull(firstScore)
        System.arraycopy(curr, 0, prev, 0, curr.size)

        // Identical frame -> ~0 motion
        val staticScore = UvcFrameSignalEvidence.computeRoadMotionScore(
            ByteBuffer.wrap(baseFrame), width, height, prev, curr
        )!!
        assertEquals(0f, staticScore, 0.01f)

        // Uniform auto-exposure brightness jump (+35 everywhere) -> still near 0 motion
        val brighterFrame = baseFrame.copyOf()
        for (i in 0 until width * height) {
            brighterFrame[i] = ((brighterFrame[i].toInt() and 0xFF) + 35).coerceAtMost(255).toByte()
        }
        val agcScore = UvcFrameSignalEvidence.computeRoadMotionScore(
            ByteBuffer.wrap(brighterFrame), width, height, prev, curr
        )!!
        assertTrue("Exposure jump must not register as movement: $agcScore", agcScore < 1.0f)

        // Shift horizontal pavement texture -> detects movement clearly
        val shiftedFrame = ByteArray(baseFrame.size)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val sx = (x + 12) % width
                shiftedFrame[y * width + x] = ((sx * 5 + y * 3) % 160 + 20).toByte()
            }
        }
        val motionScore = UvcFrameSignalEvidence.computeRoadMotionScore(
            ByteBuffer.wrap(shiftedFrame), width, height, prev, curr
        )!!
        assertTrue("Expected noticeable road texture shift score >= 5f, got $motionScore", motionScore >= 5f)
    }

    @Test
    fun computeRoadMotionScore_handlesUndersizedBufferSafely() {
        val prev = ByteArray(32)
        val curr = ByteArray(32)
        val tiny = ByteBuffer.allocate(100)
        assertNull(UvcFrameSignalEvidence.computeRoadMotionScore(tiny, 64, 48, prev, curr))
    }
}
