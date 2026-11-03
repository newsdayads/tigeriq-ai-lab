package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ReverseCameraOverlayContractTest {
    private val source = File("src/main/java/ai/tigeriq/camera/ReverseCameraOverlay.kt").readText()

    @Test fun actualWindowManagerOverlayInsteadOfBackgroundActivity() {
        assertTrue(source.contains("TYPE_APPLICATION_OVERLAY"))
        assertTrue(source.contains("manager.addView(root,params)"))
        assertTrue(source.contains("CameraEventLog.record(owner,\"WINDOW\",\"OVERLAY_VISIBLE\""))
        assertTrue(source.contains("wm?.removeViewImmediate(view)"))
        assertTrue(source.contains("Settings.canDrawOverlays(owner)"))
        assertTrue(source.contains("owner.createDisplayContext(targetDisplay)"))
        assertTrue(source.contains("dm.getDisplay(Display.DEFAULT_DISPLAY)") ||
                   source.contains("displayManager.getDisplay(Display.DEFAULT_DISPLAY)"))
        assertFalse(source.contains("else owner\n            val ctx"))
        assertFalse(source.lines().any { it.trimStart().startsWith("startActivity(") })
    }
    @Test fun usbPreviewLifecycleIsAttachedAndReleased() {
        assertTrue(source.contains("val texture=TextureView(ctx)"))
        assertFalse(source.contains("TextureView(ctx).apply{setBackgroundColor"))
        assertTrue(source.contains("val previewLayer=FrameLayout(ctx).apply"))
                assertTrue(source.contains("UsbUvcManager(owner,texture"))
        assertTrue(source.contains("helper.start()"))
        assertTrue(source.contains("camera?.release()"))
        assertTrue(source.contains("status.post"))
    }
}
