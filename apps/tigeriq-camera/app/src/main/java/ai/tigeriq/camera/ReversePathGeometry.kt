package ai.tigeriq.camera

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.tan

/** Kinematic bicycle model referenced to the rear axle; positions in metres.
 *
 * roadWheelDegrees is FRONT ROAD WHEEL angle (not steering wheel angle and not
 * gyro yaw rate). Right turn = positive x in rear-camera frame. For reverse
 * travel s, the rear axle traverses a circular arc with curvature tan(delta)/L.
 *
 * Values must be calibrated to the actual vehicle and the camera extrinsics
 * before displaying distances as measurements; default parameters are an
 * illustrative geometry model, not vehicle-certified values.
 */
object ReversePathGeometry {
    data class Corridor(
        val sMeters: Double,
        val centerX: Double,
        val centerBack: Double,
        val leftX: Double,
        val leftBack: Double,
        val rightX: Double,
        val rightBack: Double
    )

    data class TrackPoint(
        val x: Double,
        val back: Double
    )

    data class ScreenPoint(
        val x: Float,
        val y: Float
    )

    fun sample(
        distanceBack: Double,
        roadWheelDegrees: Double,
        wheelbaseMeters: Double,
        widthMeters: Double
    ): Corridor {
        require(distanceBack >= 0.0 && distanceBack <= 6.0)
        require(roadWheelDegrees in -40.0..40.0)
        require(wheelbaseMeters in 1.5..5.0)
        require(widthMeters in 1.2..3.0)
        val k = tan(roadWheelDegrees * PI / 180.0) / wheelbaseMeters
        val heading = k * distanceBack
        val x = if (abs(k) < 1e-9) 0.0 else (1.0 - cos(heading)) / k
        val backwards = if (abs(k) < 1e-9) distanceBack else sin(heading) / k
        val halfWidth = widthMeters * 0.5
        return Corridor(distanceBack, x, backwards,
            x - halfWidth * cos(heading), backwards + halfWidth * sin(heading),
            x + halfWidth * cos(heading), backwards - halfWidth * sin(heading))
    }

    /** Safe concentric offset point along rear-axle bicycle arc for any tire or body offset. */
    fun sampleTrackPoint(
        distanceBack: Double,
        roadWheelDegrees: Double,
        wheelbaseMeters: Double,
        lateralOffsetMeters: Double
    ): TrackPoint {
        val safeBack = distanceBack.coerceIn(0.0, 6.0)
        val safeAngle = roadWheelDegrees.coerceIn(-35.0, 35.0)
        val safeWheelbase = wheelbaseMeters.coerceIn(1.5, 5.0)
        val safeOffset = lateralOffsetMeters.coerceIn(-1.5, 1.5)
        val k = tan(safeAngle * PI / 180.0) / safeWheelbase
        val heading = k * safeBack
        val x = if (abs(k) < 1e-9) 0.0 else (1.0 - cos(heading)) / k
        val backwards = if (abs(k) < 1e-9) safeBack else sin(heading) / k
        return TrackPoint(
            x = x + safeOffset * cos(heading),
            back = backwards - safeOffset * sin(heading)
        )
    }

    /** Projects floor world meters (x right, back away from bumper) onto Canvas coordinates. */
    fun worldToScreen(
        worldX: Double,
        worldBack: Double,
        cx: Float,
        bottomY: Float,
        topY: Float,
        bottomHalfW: Float,
        topHalfW: Float,
        referenceDistanceBack: Double = 3.0,
        referenceHalfWidthMeters: Double = 0.90
    ): ScreenPoint {
        val safeBottomHalfW = bottomHalfW.coerceAtLeast(20f)
        val safeTopHalfW = topHalfW.coerceIn(10f, safeBottomHalfW * 0.92f)
        val ratio = safeBottomHalfW / safeTopHalfW
        val z0 = referenceDistanceBack.coerceAtLeast(0.5) / (ratio - 1.0)
        val zCam = worldBack.coerceAtLeast(0.05) + z0
        val tPersp = (z0 / zCam).toFloat()
        val perspSpan = 1f - (safeTopHalfW / safeBottomHalfW)
        val uY = (1f - tPersp) / perspSpan
        val screenY = bottomY - uY * (bottomY - topY)
        val pxPerMeter = (safeBottomHalfW * tPersp) / referenceHalfWidthMeters.coerceAtLeast(0.2).toFloat()
        return ScreenPoint(
            x = cx + worldX.toFloat() * pxPerMeter,
            y = screenY
        )
    }
}
