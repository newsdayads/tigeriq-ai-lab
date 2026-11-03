package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class UltraCarReverseSignalTest {
    @Test fun exactSourceGearOverridesState() {
        assertEquals(true, UltraCarReverseSignal.parse(
            "com.ultracar.dexsplit.ACTION_REVERSE_GEAR", false, "r"))
        for (other in arrayOf("P", "N", "D")) {
            assertEquals(false, UltraCarReverseSignal.parse(
                "com.ultracar.dexsplit.ACTION_REVERSE_GEAR", true, other))
        }
        assertEquals(true, UltraCarReverseSignal.parse("com.car.REVERSE", true, null))
        assertEquals(false, UltraCarReverseSignal.parse("com.car.REVERSE", false, null))
        assertNull(UltraCarReverseSignal.parse("com.android.car.GEAR_CHANGE", true, "R"))
        assertNull(UltraCarReverseSignal.parse(null, true, "R"))
    }
    @Test fun gearHasOneWindowWriter() {
        val service = File("src/main/java/ai/tigeriq/camera/FloatingCameraService.kt").readText()
        assertFalse(service.contains("filter.addAction(action)"))
        assertFalse(service.contains("source=dynamic_broadcast"))
        val receiver = File("src/main/java/ai/tigeriq/camera/ReverseGearReceiver.kt").readText()
        assertTrue(receiver.contains("UltraCarReverseSignal.parse("))
        assertTrue(receiver.contains("FloatingCameraService.gear(context, true)"))
        assertTrue(receiver.contains("FloatingCameraService.gear(context, false)"))
        assertTrue(service.contains("cameraOverlay.show(findDexDisplay())"))
        assertTrue(service.contains("cameraOverlay.hide()"))
        assertFalse(receiver.contains("CameraActivity.launch("))
        assertTrue(receiver.contains("CameraActivity.dismissIfRunning("))
    }
}
