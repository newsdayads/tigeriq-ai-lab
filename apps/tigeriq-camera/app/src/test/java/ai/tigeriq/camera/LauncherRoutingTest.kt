package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class LauncherRoutingTest {
    private val xml = File("src/main/AndroidManifest.xml").readText()

    @Test fun cameraIsTheOnlyLauncher() {
        val main = Regex("""<activity\s+android:name="\.MainActivity"([\s\S]*?)</activity>""").find(xml)!!.value
        val camera = Regex("""<activity\s+android:name="\.CameraActivity"([\s\S]*?)</activity>""").find(xml)!!.value
        assertFalse(main.contains("android.intent.action.MAIN"))
        assertFalse(main.contains("android.intent.category.LAUNCHER"))
        assertTrue(main.contains("""android:exported="false" """.trim()))
        assertTrue(camera.contains("android.intent.action.MAIN"))
        assertTrue(camera.contains("android.intent.category.LAUNCHER"))
        assertFalse(camera.contains("android.hardware.usb.action.USB_DEVICE_ATTACHED"))
    }
}
