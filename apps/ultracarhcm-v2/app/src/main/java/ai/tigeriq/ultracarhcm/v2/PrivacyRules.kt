package ai.tigeriq.ultracarhcm.v2

internal object PrivacyRules {
    fun statusLabel(granted: Boolean): String =
        if (granted) "Đã cấp" else "Chưa cấp"

    fun bluetoothConnectRuntimeRequired(sdkInt: Int): Boolean =
        sdkInt >= 31
}
