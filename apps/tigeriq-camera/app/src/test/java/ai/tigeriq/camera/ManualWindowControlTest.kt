package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ManualWindowControlTest {
    private val source = File("src/main/java/ai/tigeriq/camera/MainActivity.kt").readText()

    @Test fun diagnosticButtonsDirectlyControlCamera() {
        val start = source.substringAfter("btnSimulateReverseOn.setOnClickListener")
            .substringBefore("btnSimulateReverseOff.setOnClickListener")
        val stop = source.substringAfter("btnSimulateReverseOff.setOnClickListener")
            .substringBefore("btnRestartFloating.setOnClickListener")
        assertTrue(start.contains("CameraActivity.launch("))
        assertFalse(start.contains("sendBroadcast("))
        assertTrue(start.contains("MANUAL_TEST"))
        assertTrue(stop.contains("CameraActivity.dismissIfRunning("))
        assertTrue(stop.contains("ACTION_CLOSE_CAMERA"))
        assertFalse(stop.contains("ACTION_REVERSE_GEAR"))
    }
}
