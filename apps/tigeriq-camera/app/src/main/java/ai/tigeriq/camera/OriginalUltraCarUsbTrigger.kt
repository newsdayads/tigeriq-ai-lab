package ai.tigeriq.camera
import android.hardware.usb.UsbDevice

/** Actual UltraCar v1.0.17 TigerIQBridge USB presence logic.
 * Its isCameraDevice falls through to true for ANY non-null USB device.
 * Detects USB power changes, not a CAN gear message.
 */
object OriginalUltraCarUsbTrigger {
    fun hasDevice(devices: Collection<UsbDevice>) = devices.isNotEmpty()
    fun changed(previous: Boolean, current: Boolean) = previous != current
}
