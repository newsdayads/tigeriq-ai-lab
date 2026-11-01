package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.GridLayout
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
        // V1 V66 evidence: keep the original Profile-header subtitle and color it red.
        // V2 shows its own runtime version/build here; no floating version badge is added.
        body.addView(text(currentVersionLabel(), 14f, Color.RED))

        val widthDp = (resources.configuration.screenWidthDp.takeIf { it > 0 }
            ?: (resources.displayMetrics.widthPixels / density).toInt())
        val columns = ProfileLayoutRules.columnsForWidthDp(widthDp)
        val grid = GridLayout(this).apply {
            columnCount = columns
            rowCount = GridLayout.UNDEFINED
            alignmentMode = GridLayout.ALIGN_BOUNDS
            useDefaultMargins = false
        }

        fun card(title: String): LinearLayout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(16), dp(16), dp(16))
                background = GradientDrawable().apply {
                    setColor(Color.rgb(17, 38, 49))
                    cornerRadius = dp(14).toFloat()
                    setStroke(dp(1), Color.rgb(45, 96, 118))
                }
                addView(text(title, 18f).apply {
                    setTypeface(null, android.graphics.Typeface.BOLD)
                })
            }

        fun addCard(view: View, index: Int) {
            val row = index / columns
            val column = index % columns
            val spec = GridLayout.spec(row, 1f)
            val colSpec = GridLayout.spec(column, 1f)
            val lp = GridLayout.LayoutParams(spec, colSpec).apply {
                width = 0
                height = ViewGroup.LayoutParams.WRAP_CONTENT
                setMargins(dp(6), dp(6), dp(6), dp(6))
            }
            grid.addView(view, lp)
        }

        val localProfile = card("Hồ sơ cục bộ")
        localProfile.addView(text("Tên hiển thị", 14f, Color.LTGRAY))
        val input = EditText(this).apply {
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setSingleLine(true)
            hint = "Tên tài xế"
            setText(homePrefs.getString("driver_name", "Driver") ?: "Driver")
            selectAll()
        }
        localProfile.addView(
            input,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        localProfile.addView(Button(this).apply {
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
        addCard(localProfile, 0)

        val versionCard = card("Phiên bản")
        versionCard.addView(text(currentVersionLabel(), 15f, Color.LTGRAY))
        versionCard.addView(Button(this).apply {
            text = "CẬP NHẬT"
            setOnClickListener {
                startActivity(Intent(this@ProfileActivity, UpdateActivity::class.java))
            }
        })
        versionCard.addView(Button(this).apply {
            text = "THÔNG BÁO"
            setOnClickListener {
                startActivity(Intent(this@ProfileActivity, NotificationActivity::class.java))
            }
        })
        versionCard.addView(text(
            "Thông báo hiện chỉ lưu cảnh báo cập nhật V2 đã xác minh trên thiết bị; chưa có push/backend và không suy diễn parity V1.",
            13f,
            Color.LTGRAY,
        ))
        versionCard.addView(text(
            "Kiểm tra cập nhật dùng endpoint V2 riêng và vẫn fail-closed nếu chưa được xác minh.",
            13f,
            Color.LTGRAY,
        ))
        addCard(versionCard, 1)

        val identityCard = card("Danh tính và giấy phép")
        identityCard.addView(text(
            "Danh tính/giấy phép: chưa có nguồn dữ liệu V1 hoặc backend V2 được xác minh.",
            14f,
            Color.LTGRAY,
        ))
        identityCard.addView(text(
            "Đăng ký/gia hạn: chưa triển khai để tránh giả trạng thái tài khoản hoặc license.",
            14f,
            Color.LTGRAY,
        ))
        identityCard.addView(Button(this).apply {
            text = "QUẢN TRỊ VÀ GIẤY PHÉP"
            setOnClickListener {
                startActivity(Intent(this@ProfileActivity, AdminLicenseActivity::class.java))
            }
        })
        addCard(identityCard, 2)

        val reportCard = card("Báo cáo dữ liệu V2")
        reportCard.addView(text(
            "Tổng hợp lịch sử Taxi Meter V2 và xuất CSV qua vị trí người dùng chọn.",
            14f,
            Color.LTGRAY,
        ))
        reportCard.addView(Button(this).apply {
            text = "MỞ BÁO CÁO CHUYẾN"
            setOnClickListener {
                startActivity(Intent(this@ProfileActivity, ReportActivity::class.java))
            }
        })
        reportCard.addView(text(
            "Không đọc dữ liệu V1 và chưa tuyên bố tương đương mẫu XLS/dashboard của V1.",
            13f,
            Color.LTGRAY,
        ))
        addCard(reportCard, 3)

        body.addView(
            grid,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

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
