package ai.tigeriq.camera

/** Legacy API now delegates to physical bicycle geometry, not arbitrary
 * quadratic visual warping. Only valid when steeringDegrees represents a
 * VERIFIED/calibrated front-road-wheel steering angle.
 */
data class GuideCurveState(
    val reverseActive: Boolean = true,
    val steeringDegrees: Float = 0f,
    val warp: Float = 1f
)
data class GuidePoint(val x: Float,val y:Float)
data class GuideDistanceMarker(val progress:Float,val label:String)

object GuideTrackModel {
    const val MAX_STEERING_DEGREES=35f
    // Perspective marker names are deliberately not assigned real metres
    // before per-vehicle and camera calibration.
    val distanceMarkers=listOf(
        GuideDistanceMarker(0.16f,"Gan"),
        GuideDistanceMarker(0.47f,"Giua"),
        GuideDistanceMarker(0.95f,"Xa"))
    fun normalize(s: GuideCurveState):GuideCurveState =
        s.copy(steeringDegrees=s.steeringDegrees.coerceIn(-35f,35f),
            warp=s.warp.coerceIn(0.65f,1.35f))
    fun trackPoint(progress:Float,side:Int,state:GuideCurveState):GuidePoint {
        val s=progress.coerceIn(0f,1f).toDouble()*3.0
        val geometry=ReversePathGeometry.sample(s,
            normalize(state).steeringDegrees.toDouble(),2.9,1.8)
        val x=if(side<0)geometry.leftX else geometry.rightX
        val depth=if(side<0)geometry.leftBack else geometry.rightBack
        val focus=1.6
        val normalizedX=0.5+x*0.235*focus/(0.9*(focus+depth))
        val normalizedDepth=(depth/(focus+depth))/(3.0/(focus+3.0))
        return GuidePoint(normalizedX.toFloat(),
            (0.90-0.58*normalizedDepth).toFloat())
    }
    fun crossbar(progress:Float,state:GuideCurveState):Pair<GuidePoint,GuidePoint> =
        trackPoint(progress,-1,state) to trackPoint(progress,1,state)
}
