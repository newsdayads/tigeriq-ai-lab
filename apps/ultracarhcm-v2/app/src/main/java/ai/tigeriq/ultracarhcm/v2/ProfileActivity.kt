package ai.tigeriq.ultracarhcm.v2

import android.content.Context\nimport android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

class ProfileActivity : ComponentActivity() {
    private val homePrefs by lazy {
        getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()
        fun text(value: String, size: Float, color: Int = Color.WHITE) =
            TextView(this).apply {
                this.text = value
                textSize = size
                setTextColor(color)
                setPadding(0, dp(8), 0, dp(8))
            }

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(10, 20, 26))
        }

        body.addView(text("HỒ SƠ NGƯỜI LÁI", 28f).apply {
            gravity = Gravity.START
        })
        body.addView(text(currentVersionLabel(), 15f, Color.LTGRAY))
        body.addView(text("Tên hiển thị", 14f))

        val input = EditText(this).apply {
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setSingleLine(true)
            hint = "Tên tài xế"
            setText(homePrefs.getString("driver_name", "Driver") ?: "Driver")
            selectAll()
        }
        body.addView(
            input,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        body.addView(Button(this).apply {
            text = "LƯU HỒ SƠ"
            setOnClickListener {
                val name = ProfileRules.normalizeDisplayName(input.text.toString())
                if (name.isEmpty()) {
                    toast("Tên hiển thị không được để trống")
                } else {
                    homePrefs.edit().putString("driver_name", name).apply()
                    input.setText(name)
                    input.setSelection(name.length)
                    toast("Đã lưu hồ sơ V2 trên thiết bị")
                }
            }
        })
        body.addView(Button(this).apply {
            text = "CẬP NHẬT"
            setOnClickListener {
                startActivity(Intent(this@ProfileActivity, UpdateActivity::class.java))
            }
        })

        body.addView(text(
            "Danh tính/giấy phép: chưa có nguồn dữ liệu V1 hoặc backend V2 được xác minh.",
            14f,
            Color.LTGRAY,
        ))
        body.addView(text(
            "Đăng ký/gia hạn: chưa triển khai để tránh giả trạng thái tài khoản hoặc license.",
            14f,
            Color.LTGRAY,
        ))

        return ScrollView(this).apply { addView(body) }
    }

    private fun currentVersionLabel(): String {
        val info = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
            return ProfileRules.versionLabel(null, 0L)
        }
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
        return ProfileRules.versionLabel(info.versionName, code)
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
}
