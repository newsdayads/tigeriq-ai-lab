package ai.tigeriq.camera

import java.nio.ByteBuffer
import kotlin.math.max

/**
 * Experimental signal evidence for the already available UVCAndroid IFrameCallback.
 *
 * Samples only Y (luma) bytes of NV21 frames. Retains no pixels or frame images.
 * Signal characteristics are NOT gear state. Dark reversing video is possible.
 * Deliberately NEVER opens or closes any window.
 */
object UvcFrameSignalEvidence {
    data class Metrics(
        val samples: Int,
        val meanLuma: Double,
        val lumaVariance: Double,
        val darkShare: Double,
        val occupiedLumaBins: Int
    ) {
        /** Diagnostic finding, not proof of signal loss or P/N/D. */
        val lowInformation: Boolean
            get() = lumaVariance < 5.0 && occupiedLumaBins <= 2
    }

    fun sampleNv21(frame: ByteBuffer, width: Int, height: Int): Metrics? {
        if (width <= 0 || height <= 0) return null
        val pixelCountLong = width.toLong() * height.toLong()
        if (pixelCountLong > Int.MAX_VALUE) return null
        val pixelCount = pixelCountLong.toInt()
        if (frame.remaining() < pixelCount) return null
        val read = frame.asReadOnlyBuffer()
        val base = read.position()
        val stride = max(1, pixelCount / 1024)
        val bins = BooleanArray(16)
        var n = 0
        var dark = 0
        var sum = 0.0
        var squareSum = 0.0
        var i = 0
        while (i < pixelCount) {
            val y = read.get(base + i).toInt() and 0xFF
            n++
            sum += y
            squareSum += y.toDouble() * y
            if (y <= 16) dark++
            bins[y ushr 4] = true
            i += stride
        }
        val mean = sum / n
        return Metrics(
            samples = n,
            meanLuma = mean,
            lumaVariance = max(0.0, squareSum / n - mean * mean),
            darkShare = dark.toDouble() / n,
            occupiedLumaBins = bins.count { it }
        )
    }
}
