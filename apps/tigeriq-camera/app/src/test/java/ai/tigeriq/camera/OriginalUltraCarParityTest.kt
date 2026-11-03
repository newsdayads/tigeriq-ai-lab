package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class OriginalUltraCarParityTest {
    private val service = File("src/main/java/ai/tigeriq/camera/FloatingCameraService.kt").readText()
    private val receiver = File("src/main/java/ai/tigeriq/camera/UsbAttachReceiver.kt").readText()
    @Test fun referenceUsbPolling() {
        assertTrue(service.contains("postDelayed(this, 350L)"))
        assertFalse(service.contains("postDelayed(pendingUsbOpen, 400L)"))
        assertFalse(service.contains("openFromUsb(\"recognized_camera_at_start\")"))
        assertTrue(service.contains("USB_CONNECTED_NOT_GEAR"))
        assertFalse(service.contains("closeFromUsb(\"recognized_camera_disappeared\")"))
        assertTrue(service.contains("USB_LOST_NOT_R_OFF"))
        assertTrue(service.contains("UvcSignalMonitor"))
        assertTrue(service.contains("workingCameraKey()"))
    }
    @Test fun oneUsbWindowController() {
        assertFalse(receiver.contains("CameraActivity.launch"))
        assertFalse(receiver.contains("CameraActivity.dismiss"))
        assertTrue(receiver.contains("ACTION_USB_REFRESH"))
    }
    @Test fun visibilityAndCameraIdentityAreGrounded() {
        val activity = File("src/main/java/ai/tigeriq/camera/CameraActivity.kt").readText()
        val uvc = File("src/main/java/ai/tigeriq/camera/UsbUvcManager.kt").readText()
        assertTrue(service.contains("CameraActivity.isRunning()"))
        assertTrue(service.contains("workingCameraKey()"))
        assertTrue(activity.contains("isRunningFlag = false // Only onResume"))
        assertTrue(activity.contains("ACTIVITY_RESUMED"))
        assertTrue(activity.contains("ACTIVITY_PAUSED"))
        assertTrue(uvc.contains("rememberWorkingCamera(device)"))
    }
}
