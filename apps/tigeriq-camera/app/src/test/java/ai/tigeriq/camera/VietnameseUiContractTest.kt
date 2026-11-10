package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class VietnameseUiContractTest {
    private val main=File("src/main/res/layout/activity_main.xml").readText()
    private val camera=File("src/main/res/layout/activity_camera.xml").readText()
    private val strings=File("src/main/res/values/strings.xml").readText()\n    private val service=File("src/main/java/ai/tigeriq/camera/FloatingCameraService.kt").readText()

    @Test fun appUiIsValidVietnameseNotMojibake() {
        assertTrue(main.contains("TH\u1eec M\u1ede CAMERA"))
        assertTrue(main.contains("K\u1ebeT N\u1ed0I PC01"))
        assertTrue(camera.contains("C\u1ea4P QUY\u1ec0N CAMERA"))
        assertTrue(strings.contains("Camera UVC"))
        assertTrue(service.contains("getString(R.string.floating_service_desc)"))\n        assertFalse(service.contains("N?t Camera"))\n        for (source in arrayOf(main,camera,strings,service))
            assertFalse(source.contains("\uFFFD"))
    }
}
