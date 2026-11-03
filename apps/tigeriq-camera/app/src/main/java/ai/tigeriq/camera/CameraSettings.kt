package ai.tigeriq.camera

import android.content.Context
import android.content.SharedPreferences

class CameraSettings(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("tigeriq_camera_prefs", Context.MODE_PRIVATE)

    companion object {
        const val STYLE_SPORT_OEM = 0
        const val STYLE_PORSCHE_GT = 1
        const val STYLE_AUDI_MATRIX = 2
        const val STYLE_TESLA_CYBER = 3
        const val STYLE_LUXURY_GOLD = 4
        const val TOTAL_STYLES = 5

        // Backwards compatibility
        const val STYLE_SPORT_RACING = 0
        const val STYLE_LUXURY_OEM = 4
        const val STYLE_MINIMALIST = 3

        private const val KEY_FLOATING_ENABLED = "floating_enabled"
        private const val KEY_REVERSE_AUTO_START = "reverse_auto_start"
        private const val KEY_USB_AUTO_START = "usb_auto_start"
        private const val KEY_GUIDELINES_ENABLED = "guidelines_enabled"
        private const val KEY_WARP_FACTOR = "warp_factor"
        private const val KEY_REVERSE_IMMEDIATE_CLOSE = "reverse_immediate_close"
        private const val KEY_STEERING_INVERTED = "steering_inverted"
        private const val KEY_GUIDELINE_STYLE = "guideline_style"
        private const val KEY_GUIDELINE_SCALE = "guideline_scale"
        private const val KEY_GUIDELINE_OFFSET_Y = "guideline_offset_y"
        private const val KEY_PARK_ASSIST_BEEP = "park_assist_beep"
        private const val KEY_NIGHT_BOOSTER = "night_booster"
    }

    var isParkAssistBeepEnabled: Boolean
        get() = prefs.getBoolean(KEY_PARK_ASSIST_BEEP, true)
        set(value) = prefs.edit().putBoolean(KEY_PARK_ASSIST_BEEP, value).apply()

    var isNightBoosterEnabled: Boolean
        get() = prefs.getBoolean(KEY_NIGHT_BOOSTER, false)
        set(value) = prefs.edit().putBoolean(KEY_NIGHT_BOOSTER, value).apply()

    // Persist the VID/PID of the USB video device that actually opened.
    // Prevent a permanently attached DeX hub from impersonating reverse Camera.
    fun rememberWorkingCamera(device: android.hardware.usb.UsbDevice) {
        prefs.edit()
            .putInt("working_camera_vid", device.vendorId)
            .putInt("working_camera_pid", device.productId)
            .apply()
    }
    fun workingCameraKey(): String? {
        val vendor = prefs.getInt("working_camera_vid", -1)
        val product = prefs.getInt("working_camera_pid", -1)
        return if (vendor >= 0 && product >= 0) "$vendor:$product" else null
    }
    var isFloatingEnabled: Boolean
        get() = prefs.getBoolean(KEY_FLOATING_ENABLED, true)
        set(value) = prefs.edit().putBoolean(KEY_FLOATING_ENABLED, value).apply()

    var isReverseAutoStart: Boolean
        get() = prefs.getBoolean(KEY_REVERSE_AUTO_START, true)
        set(value) = prefs.edit().putBoolean(KEY_REVERSE_AUTO_START, value).apply()

    var isUsbAutoStart: Boolean
        get() = prefs.getBoolean(KEY_USB_AUTO_START, true)
        set(value) = prefs.edit().putBoolean(KEY_USB_AUTO_START, value).apply()

    var isReverseImmediateClose: Boolean
        get() = prefs.getBoolean(KEY_REVERSE_IMMEDIATE_CLOSE, true)
        set(value) = prefs.edit().putBoolean(KEY_REVERSE_IMMEDIATE_CLOSE, value).apply()

    var isGuidelinesEnabled: Boolean
        get() = prefs.getBoolean(KEY_GUIDELINES_ENABLED, true)
        set(value) = prefs.edit().putBoolean(KEY_GUIDELINES_ENABLED, value).apply()

    var isSteeringInverted: Boolean
        get() = prefs.getBoolean(KEY_STEERING_INVERTED, false)
        set(value) = prefs.edit().putBoolean(KEY_STEERING_INVERTED, value).apply()

    var guidelineStyle: Int
        get() = prefs.getInt(KEY_GUIDELINE_STYLE, STYLE_SPORT_RACING)
        set(value) = prefs.edit().putInt(KEY_GUIDELINE_STYLE, value).apply()

    var guidelineScale: Float
        get() = prefs.getFloat(KEY_GUIDELINE_SCALE, 1.0f)
        set(value) = prefs.edit().putFloat(KEY_GUIDELINE_SCALE, value).apply()

    var guidelineOffsetY: Float
        get() = prefs.getFloat(KEY_GUIDELINE_OFFSET_Y, 0.0f)
        set(value) = prefs.edit().putFloat(KEY_GUIDELINE_OFFSET_Y, value).apply()

    var warpFactor: Float
        get() = prefs.getFloat(KEY_WARP_FACTOR, 1.0f)
        set(value) = prefs.edit().putFloat(KEY_WARP_FACTOR, value).apply()

    // USB presence and genuine vehicle gear broadcasts are independent signals.
    fun recordReverseSignal(action: String, active: Boolean) {
        prefs.edit()
            .putString("last_gear_action", action)
            .putBoolean("last_gear_reverse", active)
            .putLong("last_gear_timestamp", System.currentTimeMillis())
            .apply()
    }

    fun recordUsbState(present: Boolean, changed: Boolean) {
        val edit = prefs.edit().putBoolean("last_usb_present", present)
        if (changed) edit.putLong("last_usb_change", System.currentTimeMillis())
        edit.apply()
    }

    fun getReverseDiagnostics(): String {
        val timestamp = prefs.getLong("last_gear_timestamp", 0L)
        val usbChanged = prefs.getLong("last_usb_change", 0L)
        val time: (Long) -> String = { t ->
            if (t == 0L) "chưa ghi nhận"
            else android.text.format.DateFormat.format("HH:mm:ss", t).toString()
        }
        val gear = if (timestamp == 0L) "Chưa có tín hiệu số R thực từ xe"
                   else (prefs.getString("last_gear_action", "?") + " " +
                         (if (prefs.getBoolean("last_gear_reverse", false)) "R ON" else "R OFF") +
                         " " + time(timestamp))
        val usb = (if (prefs.getBoolean("last_usb_present", false)) "Có thiết bị" else "Không có thiết bị") +
                  " | Thay đổi: " + time(usbChanged)
        return "Broadcast R (chưa xác minh nguồn xe): " + gear + "\nUSB: " + usb
    }

    fun getFloatingX(displayId: Int, defaultVal: Int): Int =
        prefs.getInt("floating_x_$displayId", defaultVal)

    fun getFloatingY(displayId: Int, defaultVal: Int): Int =
        prefs.getInt("floating_y_$displayId", defaultVal)

    fun setFloatingPosition(displayId: Int, x: Int, y: Int) {
        prefs.edit()
            .putInt("floating_x_$displayId", x)
            .putInt("floating_y_$displayId", y)
            .apply()
    }
}
