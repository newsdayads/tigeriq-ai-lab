package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer

class UvcFrameSignalEvidenceTest {
    @Test fun blackFrameProvidesEvidenceNotGearState() {
        val m = UvcFrameSignalEvidence.sampleNv21(ByteBuffer.wrap(ByteArray(64)), 8, 8)!!
        assertEquals(0.0, m.meanLuma, 0.00001)
        assertEquals(1.0, m.darkShare, 0.00001)
        assertTrue(m.lowInformation)
    }

    @Test fun gradientHasMoreInformation() {
        val data = ByteArray(64) { (it * 4).toByte() }
        val m = UvcFrameSignalEvidence.sampleNv21(ByteBuffer.wrap(data), 8, 8)!!
        assertTrue(m.lumaVariance > 100.0)
        assertTrue(m.occupiedLumaBins > 2)
        assertFalse(m.lowInformation)
    }

    @Test fun nonzeroBufferOffsetAndInvalidPayload() {
        val b = ByteBuffer.wrap(byteArrayOf(99, 0, 0, 0, 0, 99))
        b.position(1)
        b.limit(5)
        assertNotNull(UvcFrameSignalEvidence.sampleNv21(b, 2, 2))
        assertEquals(1, b.position())
        assertNull(UvcFrameSignalEvidence.sampleNv21(b, 3, 2))
        assertNull(UvcFrameSignalEvidence.sampleNv21(b, 0, 2))
    }

    @Test fun doesNotDriveWindowOrAssumeReverse() {
        val source = java.io.File("src/main/java/ai/tigeriq/camera/UvcFrameSignalEvidence.kt").readText()
        assertFalse(source.contains("CameraActivity.launch"))
        assertFalse(source.contains("CameraActivity.dismiss"))
        assertFalse(source.contains("GEAR_REVERSE"))
    }
}
