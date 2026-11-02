package ai.tigeriq.camera

/**
 * Reconstructed V1/V2 Dynamic Reverse Guide Geometry Model.
 * Values are normalized to [0,1]; provides perspective curves and distance markers.
 */
data class GuideCurveState(
    val reverseActive: Boolean = true,
    val steeringDegrees: Float = 0f,
    val warp: Float = 1f,
)

data class GuidePoint(
    val x: Float,
    val y: Float,
)

data class GuideDistanceMarker(
    val progress: Float,
    val label: String,
)

object GuideTrackModel {
    const val MAX_STEERING_DEGREES = 35f

    /**
     * Visual distance markers matching the V1 reverse camera specification:
     * - 0.5m (Red alert zone)
     * - 1.0m (Yellow warning zone)
     * - 1.5m (Green safe entry zone)
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

        // Perspective trapezoid: guide narrows toward horizon
        val halfWidthBottom = 0.235f
        val halfWidthTop = 0.070f
        val halfWidth = halfWidthBottom + (halfWidthTop - halfWidthBottom) * p

        // Dynamic steering bend with quadratic curvature
        val steeringRatio = normalized.steeringDegrees / MAX_STEERING_DEGREES
        val lateralCurve = steeringRatio * 0.24f * p * p * normalized.warp

        val x = (0.5f + sideSign * halfWidth + lateralCurve).coerceIn(0.04f, 0.96f)
        val y = (0.91f - 0.64f * p).coerceIn(0.20f, 0.94f)
        return GuidePoint(x, y)
    }

    fun crossbar(progress: Float, state: GuideCurveState): Pair<GuidePoint, GuidePoint> =
        trackPoint(progress, -1, state) to trackPoint(progress, 1, state)
}
