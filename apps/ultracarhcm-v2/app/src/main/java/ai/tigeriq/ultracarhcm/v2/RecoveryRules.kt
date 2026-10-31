package ai.tigeriq.ultracarhcm.v2

internal object RecoveryRules {
    const val EXPECTED_PACKAGE = "ai.tigeriq.ultracarhcm.v2"

    fun hex(bytes: ByteArray): String =
        bytes.joinToString(separator = "") { byte -> "%02X".format(byte.toInt() and 0xFF) }

    fun isExpectedPackageName(packageName: String): Boolean =
        packageName == EXPECTED_PACKAGE

    fun formatSigningSha256(digests: List<ByteArray>): String? {
        val values = digests
            .map(::hex)
            .distinct()
            .sorted()
        return values.takeIf { it.isNotEmpty() }?.joinToString("\n")
    }

    fun versionLabel(versionName: String?, versionCode: Long): String {
        val name = versionName?.trim().orEmpty().ifBlank { "không rõ" }
        return "$name (build $versionCode)"
    }

    fun rollbackBoundaryText(): String =
        "Rollback chỉ thực hiện khi có APK V2 đã xác minh, bản sao lưu phù hợp và tuyến cài đặt thiết bị được phép."
}
