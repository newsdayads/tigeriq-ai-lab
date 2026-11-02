package ai.tigeriq.camera

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.util.Log

/**
 * Hardware USB power trigger for rear cameras wired directly to the vehicle reverse tail-light.
 * When reverse gear is engaged, tail-light powers the USB camera -> triggers USB_DEVICE_ATTACHED.
 * When shifted to Park/Drive, power cuts -> triggers USB_DEVICE_DETACHED.
 */
class UsbAttachReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "TigerIQ_UsbAttach"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val settings = CameraSettings(context)
        if (!settings.isUsbAutoStart) return

        val action = intent.action ?: return
        val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)

        if (action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
            val isCamera = device == null || UsbUvcManager.isUvc(device) ||
                    (device.vendorId == 0xff02 && device.productId == 0xafa1)
            if (isCamera) {
                Log.i(TAG, "UVC Camera attached via reverse power -> Auto-launching camera")
                val targetDisplay = DeXDisplayHelper.resolveTargetDisplay(context)
                val displayId = targetDisplay?.displayId ?: -1
                CameraActivity.launch(
                    context = context,
                    displayId = displayId,
                    reverseActive = true
                )
            }
        } else if (action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
            val isCamera = device == null || UsbUvcManager.isUvc(device) ||
                    (device.vendorId == 0xff02 && device.productId == 0xafa1)
            if (isCamera) {
                Log.i(TAG, "UVC Camera detached -> Tail-light power cut, auto-dismissing camera immediately")
                CameraActivity.dismissIfRunning(immediate = true)
                try {
                    context.sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                } catch (_: Throwable) {}
            }
        }
    }
}
