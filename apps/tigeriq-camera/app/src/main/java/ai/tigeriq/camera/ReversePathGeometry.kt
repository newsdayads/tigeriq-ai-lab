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
}
