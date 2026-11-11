package ai.tigeriq.camera

import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.max

/**
 * Experimental signal evidence for the already available UVCAndroid IFrameCallback.
 *
 * Samples only Y (luma) bytes of NV21 frames. Retains no pixels or frame images.
 * Signal characteristics are NOT gear state. Dark reversing video is possible.
 * Deliberately NEVER opens or closes any window.
 */
object UvcFrameSignalEvidence {
    const val ROAD_MOTION_GRID_SIZE = 32 // 8 cols x 4 rows across lower road band

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

    /**
     * Zero-allocation lower-road luma motion estimator immune to uniform AGC exposure jumps.
     * Writes 32 sampled Y bytes into [outSample] and compares zero-mean MAD against [previousSample].
     */
    fun computeRoadMotionScore(
        frame: ByteBuffer,
        width: Int,
        height: Int,
        previousSample: ByteArray,
        outSample: ByteArray
    ): Float? {
        if (width < 16 || height < 16) return null
        if (previousSample.size < ROAD_MOTION_GRID_SIZE || outSample.size < ROAD_MOTION_GRID_SIZE) return null
        val pixelCountLong = width.toLong() * height.toLong()
        if (pixelCountLong > Int.MAX_VALUE || frame.remaining() < pixelCountLong) return null

        val read = frame.asReadOnlyBuffer()
        val base = read.position()
        var idx = 0
        var sumCur = 0
        var sumPrev = 0

        for (row in 0 until 4) {
            val y = ((0.56f + row * 0.10f) * height).toInt().coerceIn(0, height - 1)
            val rowBase = base + y * width
            for (col in 0 until 8) {
                val x = ((0.15f + col * 0.10f) * width).toInt().coerceIn(0, width - 1)
                val lumaCur = read.get(rowBase + x).toInt() and 0xFF
                val lumaPrev = previousSample[idx].toInt() and 0xFF
                outSample[idx] = lumaCur.toByte()
                sumCur += lumaCur
                sumPrev += lumaPrev
                idx++
            }
        }

        val meanCur = sumCur / ROAD_MOTION_GRID_SIZE.toFloat()
        val meanPrev = sumPrev / ROAD_MOTION_GRID_SIZE.toFloat()
        var mad = 0f
        for (i in 0 until ROAD_MOTION_GRID_SIZE) {
            val cur = (outSample[i].toInt() and 0xFF) - meanCur
            val prev = (previousSample[i].toInt() and 0xFF) - meanPrev
            mad += abs(cur - prev)
        }
        return mad / ROAD_MOTION_GRID_SIZE.toFloat()
    }
}
