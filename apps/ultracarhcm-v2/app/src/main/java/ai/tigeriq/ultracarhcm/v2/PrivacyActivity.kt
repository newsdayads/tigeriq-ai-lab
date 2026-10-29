package ai.tigeriq.ultracarhcm.v2

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

class PrivacyActivity : ComponentActivity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshStatus()
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
            text = "QUYỀN VÀ RIÊNG TƯ"
            textSize = 26f
            setTextColor(Color.WHITE)
        })

        status = TextView(this).apply {
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(16))
        }
        body.addView(status)
        refreshStatus()

        body.addView(Button(this).apply {
            text = "MỞ CÀI ĐẶT ỨNG DỤNG"
            setOnClickListener {
                startActivity(
                    Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:$packageName"),
                    ),
                )
            }
        })

        body.addView(Button(this).apply {
            text = "MỞ QUYỀN HIỂN THỊ TRÊN ỨNG DỤNG KHÁC"
            setOnClickListener {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName"),
                    ),
                )
            }
        })

        body.addView(TextView(this).apply {
            text =
                "USB Host dùng quyền theo từng thiết bị USB khi Camera được mở. " +
                "V2 không tự cấp quyền hệ thống. Sao lưu V2 do người dùng chọn tệp qua SAF; " +
                "Android automatic backup đang tắt trong manifest."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(16), 0, dp(8))
        })

        body.addView(TextView(this).apply {
            text =
                "Đây là trạng thái quyền của mã V2 hiện có, chưa phải biên bản tương đương privacy/permission đầy đủ của V1."
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

    private fun refreshStatus() {
        val camera = hasPermission(Manifest.permission.CAMERA)
        val coarse = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        val fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        val bluetooth = if (PrivacyRules.bluetoothConnectRuntimeRequired(Build.VERSION.SDK_INT)) {
            hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            true
        }
        val overlay = Settings.canDrawOverlays(this)

        status.text = buildString {
            append("Camera: ").append(PrivacyRules.statusLabel(camera))
            append("\nVị trí gần đúng: ").append(PrivacyRules.statusLabel(coarse))
            append("\nVị trí chính xác: ").append(PrivacyRules.statusLabel(fine))
            append("\nBluetooth Connect: ").append(PrivacyRules.statusLabel(bluetooth))
            append("\nOverlay DeX: ").append(PrivacyRules.statusLabel(overlay))
            append("\nInternet: khai báo trong manifest, không có runtime prompt")
        }
    }

    private fun hasPermission(permission: String): Boolean =
        checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
}
