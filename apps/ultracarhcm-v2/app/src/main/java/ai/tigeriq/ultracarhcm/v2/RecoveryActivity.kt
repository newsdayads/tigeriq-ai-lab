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
import java.security.MessageDigest

class RecoveryActivity : ComponentActivity() {
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
            text = "PHỤC HỒI VÀ BẢN CÀI V2"
            textSize = 26f
            setTextColor(Color.WHITE)
        })
        body.addView(TextView(this).apply {
            text = installedIdentity()
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(12), 0, dp(16))
        })
        body.addView(TextView(this).apply {
            text =
                "Android automatic backup của V2 đang tắt theo manifest. " +
                "Sao lưu thủ công chỉ chứa trạng thái V2-owned và không mang theo quyền SAF gắn thiết bị."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(8))
        })
        body.addView(TextView(this).apply {
            text = RecoveryRules.rollbackBoundaryText()
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(8))
        })
        body.addView(TextView(this).apply {
            text =
                "Màn này chỉ đọc định danh bản cài. Không tự hạ phiên bản, không cài APK, " +
                "không đổi chữ ký và không vượt bảo vệ Package Installer."
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

    internal fun installedIdentity(): String {
        val info = try {
            packageManager.getPackageInfo(packageName, packageInfoFlags())
        } catch (_: PackageManager.NameNotFoundException) {
            return "Không đọc được thông tin package đã cài."
        }

        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

        return buildString {
            append("Package: ").append(packageName)
            append("\nĐúng package V2: ")
                .append(if (RecoveryRules.isExpectedPackageName(packageName)) "Có" else "Không")
            append("\nPhiên bản: ")
                .append(RecoveryRules.versionLabel(info.versionName, code))
            append("\nSHA-256 chứng thư ký hiện tại: ")
                .append(signingSha256(info) ?: "không đọc được")
        }
    }

    @Suppress("DEPRECATION")
    private fun packageInfoFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }

    @Suppress("DEPRECATION")
    internal fun signingSha256(info: android.content.pm.PackageInfo): String? {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = info.signingInfo ?: return null
            if (signingInfo.hasMultipleSigners()) {
                signingInfo.apkContentsSigners?.toList().orEmpty()
            } else {
                signingInfo.signingCertificateHistory
                    ?.lastOrNull()
                    ?.let(::listOf)
                    .orEmpty()
            }
        } else {
            info.signatures?.toList().orEmpty()
        }
        if (signatures.isEmpty()) return null

        val digest = MessageDigest.getInstance("SHA-256")
        val fingerprints = signatures.map { certificate ->
            digest.digest(certificate.toByteArray())
        }
        return RecoveryRules.formatSigningSha256(fingerprints)
    }
}
