package ai.tigeriq.ultracarhcm.v2

import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

class AdminLicenseActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(10, 20, 26))
        }

        body.addView(TextView(this).apply {
            text = "QUẢN TRỊ VÀ GIẤY PHÉP"
            textSize = 26f
            setTextColor(Color.WHITE)
        })

        body.addView(TextView(this).apply {
            text = localInstallStatus()
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(12), 0, dp(16))
        })

        body.addView(TextView(this).apply {
            text = buildString {
                append("Backend giấy phép: ").append(AdminLicenseRules.backendStatus())
                append("\nKích hoạt khách hàng: ").append(AdminLicenseRules.activationStatus())
                append("\nĐăng ký thiết bị: ").append(AdminLicenseRules.registrationStatus())
            }
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(16))
        })

        body.addView(TextView(this).apply {
            text = AdminLicenseRules.safetyBoundary()
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(8))
        })

        body.addView(TextView(this).apply {
            text =
                "Màn này chỉ đọc trạng thái cục bộ của bản V2 đang cài. " +
                "Không có nút kích hoạt, gia hạn, đăng ký hay thay đổi license khi backend chưa được xác minh."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(8))
        })

        return ScrollView(this).apply {
            addView(
                body,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
    }

    internal fun localInstallStatus(): String {
        val info = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
            return "Không đọc được thông tin bản cài V2."
        }

        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
        val model = listOf(Build.MANUFACTURER, Build.MODEL)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString(" ")
            .ifEmpty { "unknown" }

        return buildString {
            append("Package: ").append(packageName)
            append("\nPhiên bản: ").append(ProfileRules.versionLabel(info.versionName, code))
            append("\nThiết bị cục bộ: ").append(model)
            append("\nChế độ quản trị: CHỈ ĐỌC / FAIL-CLOSED")
        }
    }
}
