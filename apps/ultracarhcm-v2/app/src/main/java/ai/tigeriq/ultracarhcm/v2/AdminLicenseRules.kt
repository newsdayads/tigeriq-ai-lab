package ai.tigeriq.ultracarhcm.v2

internal object AdminLicenseRules {
    const val VERIFIED_BACKEND_CONFIGURED = false

    fun backendStatus(): String =
        if (VERIFIED_BACKEND_CONFIGURED) "ĐÃ XÁC MINH" else "CHƯA CẤU HÌNH"

    fun activationStatus(): String =
        if (VERIFIED_BACKEND_CONFIGURED) "KHẢ DỤNG" else "KHÔNG KHẢ DỤNG"

    fun registrationStatus(): String =
        if (VERIFIED_BACKEND_CONFIGURED) "KHẢ DỤNG" else "KHÔNG KHẢ DỤNG"

    fun safetyBoundary(): String =
        "V2 không tự tạo license, không kích hoạt khách hàng, không đăng ký thiết bị và không thu thập credential khi chưa có backend/hợp đồng đã xác minh."
}
