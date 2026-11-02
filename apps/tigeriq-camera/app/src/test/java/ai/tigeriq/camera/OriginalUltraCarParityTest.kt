package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class OriginalUltraCarParityTest {
    private val service = File("src/main/java/ai/tigeriq/camera/FloatingCameraService.kt").readText()
    private val receiver = File("src/main/java/ai/tigeriq/camera/UsbAttachReceiver.kt").readText()
    @Test fun referenceUsbPolling() {
        assertTrue(service.contains("postDelayed(this, 350L)"))
        assertTrue(service.contains("postDelayed(pendingUsbOpen, 400L)"))
        assertTrue(service.contains("if (present) openFromUsb(\"initial_usb_present\")"))
        assertTrue(service.contains("closeFromUsb(\"usb_disconnected\")"))
        assertTrue(service.contains("OriginalUltraCarUsbTrigger.hasDevice(devices)"))
    }
    @Test fun oneUsbWindowController() {
        assertFalse(receiver.contains("CameraActivity.launch"))
        assertFalse(receiver.contains("CameraActivity.dismiss"))
        assertTrue(receiver.contains("ACTION_USB_REFRESH"))
    }
}
