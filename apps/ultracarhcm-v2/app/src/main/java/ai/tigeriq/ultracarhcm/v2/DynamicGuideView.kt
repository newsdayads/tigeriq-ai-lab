package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
internal data class GuideCurveState(
    val reverseActive: Boolean = false,
    val steeringDegrees: Float = 0f,
    val warp: Float = 1f,
)

internal data class GuidePoint(
    val x: Float,
    val y: Float,
)

internal data class GuideDistanceMarker(
    val progress: Float,
    val label: String,
)

/**
 * Pure geometry model for V1.0.64-style reverse guide reconstruction.
 * Values are normalized to [0,1]; no claim of calibrated vehicle distance.
 */
internal object GuideTrackModel {
    const val MAX_STEERING_DEGREES = 35f

    /**
     * Visual labels observed in the Owner's V1 reverse-camera reference video.
     * These are parity labels only; they are not a vehicle-distance calibration claim.
     */
    val distanceMarkers = listOf(
        GuideDistanceMarker(progress = 0.72f, label = "1.5m"),
        GuideDistanceMarker(progress = 0.48f, label = "1.0m"),
        GuideDistanceMarker(progress = 0.22f, label = "0.5m"),
    )

    fun normalize(state: GuideCurveState): GuideCurveState =
        state.copy(
            steeringDegrees = state.steeringDegrees.coerceIn(-MAX_STEERING_DEGREES, MAX_STEERING_DEGREES),
            warp = state.warp.coerceIn(0.65f, 1.35f),
        )

    fun trackPoint(progress: Float, side: Int, state: GuideCurveState): GuidePoint {
        val normalized = normalize(state)
        val p = progress.coerceIn(0f, 1f)
        val sideSign = if (side < 0) -1f else 1f

        // Perspective: guide narrows toward the horizon.
        val halfWidthBottom = 0.235f
        val halfWidthTop = 0.070f
        val halfWidth = halfWidthBottom + (halfWidthTop - halfWidthBottom) * p

        // Steering bends the guide progressively farther from the vehicle.
        val steeringRatio = normalized.steeringDegrees / MAX_STEERING_DEGREES
        val lateralCurve = steeringRatio * 0.24f * p * p * normalized.warp

        // Bottom of camera frame is progress=0, horizon is progress=1.
        val x = (0.5f + sideSign * halfWidth + lateralCurve).coerceIn(0.04f, 0.96f)
        val y = (0.91f - 0.64f * p).coerceIn(0.20f, 0.94f)
        return GuidePoint(x, y)
    }

    fun crossbar(progress: Float, state: GuideCurveState): Pair<GuidePoint, GuidePoint> =
        trackPoint(progress, -1, state) to trackPoint(progress, 1, state)
}

/**
 * Canvas implementation of the reconstructed guide. This is Android Canvas code,
 * not JNI/native calibration and not proof of real-vehicle accuracy.
 */
open class GuideTrackView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val crossbarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        strokeCap = Paint.Cap.ROUND
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        setShadowLayer(4f, 0f, 1f, Color.BLACK)
    }

    internal var curveState: GuideCurveState = GuideCurveState()
        private set

    internal fun updateGuide(state: GuideCurveState) {
        val next = GuideTrackModel.normalize(state)
        if (next == curveState) return
        curveState = next
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!curveState.reverseActive || width <= 0 || height <= 0) return

        drawBoundary(canvas, -1)
        drawBoundary(canvas, 1)
        labelPaint.textSize = (height * 0.028f).coerceIn(20f, 42f)
        drawCrossbar(canvas, GuideTrackModel.distanceMarkers[2], Color.RED)
        drawCrossbar(canvas, GuideTrackModel.distanceMarkers[1], Color.YELLOW)
        drawCrossbar(canvas, GuideTrackModel.distanceMarkers[0], Color.GREEN)
    }

    private fun drawBoundary(canvas: Canvas, side: Int) {
        val path = Path()
        for (step in 0..28) {
            val p = step / 28f
            val point = GuideTrackModel.trackPoint(p, side, curveState)
            val x = point.x * width
            val y = point.y * height
            if (step == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        trackPaint.color = Color.WHITE
        trackPaint.alpha = 225
        canvas.drawPath(path, trackPaint)
    }

    private fun drawCrossbar(canvas: Canvas, marker: GuideDistanceMarker, color: Int) {
        val (left, right) = GuideTrackModel.crossbar(marker.progress, curveState)
        crossbarPaint.color = color
        crossbarPaint.alpha = 235
        val leftX = left.x * width
        val rightX = right.x * width
        val y = left.y * height
        canvas.drawLine(leftX, y, rightX, right.y * height, crossbarPaint)

        // Match the V1 visual reference while keeping calibration explicitly out of scope.
        val centerX = (leftX + rightX) / 2f
        val labelY = y - labelPaint.textSize * 0.28f
        canvas.drawText(marker.label, centerX, labelY, labelPaint)
    }
}

/** V1 naming parity surface for the dynamic curved guide. */
class DynamicGuideView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : GuideTrackView(context, attrs)

/**
 * V1 naming parity surface for perspective warp.
 * Current V2 uses Canvas geometry only; no native/JNI implementation is claimed.
 */
class NativeGuideWarpView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : GuideTrackView(context, attrs) {
    fun updateWarpedGuide(reverseActive: Boolean, steeringDegrees: Float, warp: Float) {
        updateGuide(
            GuideCurveState(
                reverseActive = reverseActive,
                steeringDegrees = steeringDegrees,
                warp = warp,
            ),
        )
    }
}
