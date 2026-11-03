package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class ReversePathGeometryTest {
    private fun sample(d:Double,angle:Double) =
        ReversePathGeometry.sample(d,angle,2.9,1.8)

    @Test fun straightKeepsParallelVehicleCorridor() {
        for(distance in listOf(0.0,0.5,1.0,2.0,3.0)) {
            val p=sample(distance,0.0)
            assertEquals(0.0,p.centerX,1e-9)
            assertEquals(distance,p.centerBack,1e-9)
            assertEquals(-0.9,p.leftX,1e-9)
            assertEquals(0.9,p.rightX,1e-9)
        }
    }
    @Test fun turningRightAndLeftMirrorCorrectly() {
        for(distance in listOf(0.5,1.0,2.0,3.0)) {
            val right=sample(distance,25.0)
            val left=sample(distance,-25.0)
            assertTrue(right.centerX>0.0)
            assertTrue(left.centerX<0.0)
            assertEquals(right.centerX,-left.centerX,1e-7)
            assertEquals(right.centerBack,left.centerBack,1e-7)
            assertEquals(right.rightX,-left.leftX,1e-7)
            assertEquals(right.leftX,-left.rightX,1e-7)
        }
    }
    @Test fun largerSteeringPredictsTighterArcAndMonotonicDistance() {
        assertTrue(sample(2.0,30.0).centerX>sample(2.0,10.0).centerX)
        assertTrue(sample(3.0,25.0).centerX>sample(1.0,25.0).centerX)
    }
    @Test fun rejectsImpossibleGeometry() {
        try { ReversePathGeometry.sample(2.0,25.0,0.0,1.8); fail() }
        catch(_:IllegalArgumentException){}
        try { ReversePathGeometry.sample(2.0,80.0,2.9,1.8); fail() }
        catch(_:IllegalArgumentException){}
    }
    @Test fun noPhoneGyroIsUsedAsWheelAngle() {
        val view=java.io.File("src/main/java/ai/tigeriq/camera/DynamicGuideView.kt").readText()
        assertFalse(view.contains("TYPE_GYROSCOPE"))
        assertFalse(view.contains("SensorEventListener"))
        assertTrue(view.contains("setVerifiedRoadWheelAngleDegrees"))
        assertTrue(view.contains("verifiedRoadWheelAngleDegrees = null"))
        assertTrue(view.contains("ReversePathGeometry.sample"))
        assertTrue(view.contains("val bottomHalfW = (w * 0.30f * scale)"))
        assertTrue(view.contains("val topHalfW = (w * 0.13f * scale)"))
        assertTrue(view.contains("drawSportRacing("))
        assertTrue(view.contains("drawPorscheGt("))
        assertTrue(view.contains("drawAudiMatrix("))
        assertTrue(view.contains("drawTeslaCyber("))
        assertTrue(view.contains("drawLuxuryOem("))
    }
}
