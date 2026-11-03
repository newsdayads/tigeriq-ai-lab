package ai.tigeriq.camera

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbManager

/** Only wakes the original UltraCar-style watcher; does not open UI independently. */
class UsbAttachReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != UsbManager.ACTION_USB_DEVICE_ATTACHED &&
            action != UsbManager.ACTION_USB_DEVICE_DETACHED) return
        CameraEventLog.record(context, "ULTRACAR_USB", "RECEIVER_WAKEUP", action)
        if (!CameraSettings(context).isUsbAutoStart) return
        FloatingCameraService.start(context)
        try {
            context.startService(Intent(context, FloatingCameraService::class.java).apply {
                this.action = FloatingCameraService.ACTION_USB_REFRESH
            })
        } catch (_: Throwable) {
            // The foreground watcher also independently polls USB every 350 ms.
        }
    }
}
