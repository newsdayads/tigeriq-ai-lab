package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

class NotificationActivity : ComponentActivity() {
    private val prefs by lazy {
        getSharedPreferences(NotificationRules.PREFS_NAME, Context.MODE_PRIVATE)
    }

    private lateinit var status: TextView
    private lateinit var markReadButton: Button
    private lateinit var clearButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refresh()
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
            text = "THÔNG BÁO V2"
            textSize = 26f
            setTextColor(Color.WHITE)
        })
        body.addView(TextView(this).apply {
            text =
                "Chỉ hiển thị thông báo cập nhật V2 đã được kiểm tra từ metadata HTTPS. " +
                "Không có push/backend và không đọc dữ liệu V1."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(16))
        })

        status = TextView(this).apply {
            textSize = 16f
            setTextColor(Color.WHITE)
            setPadding(0, dp(8), 0, dp(16))
        }
        body.addView(status)

        markReadButton = Button(this).apply {
            text = "ĐÁNH DẤU ĐÃ ĐỌC"
            setOnClickListener {
                if (prefs.edit().putBoolean(NotificationRules.KEY_READ, true).commit()) {
                    refresh()
                } else {
                    toast("Không thể đánh dấu thông báo đã đọc")
                }
            }
        }
        body.addView(
            markReadButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        clearButton = Button(this).apply {
            text = "XÓA THÔNG BÁO CỤC BỘ"
            setOnClickListener {
                if (prefs.edit().clear().commit()) {
                    refresh()
                } else {
                    toast("Không thể xóa thông báo cục bộ")
                }
            }
        }
        body.addView(
            clearButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        refresh()
        return ScrollView(this).apply { addView(body) }
    }

    private fun refresh() {
        val versionCode = prefs.getLong(NotificationRules.KEY_VERSION_CODE, 0L)
        if (NotificationRules.isResolvedNotice(currentVersionCode(), versionCode)) {
            prefs.edit().clear().apply()
            renderEmpty()
            return
        }
        if (versionCode <= 0L) {
            renderEmpty()
            return
        }

        val versionName = prefs.getString(NotificationRules.KEY_VERSION_NAME, "") ?: ""
        val notes = prefs.getString(NotificationRules.KEY_RELEASE_NOTES, "") ?: ""
        val createdAt = prefs.getLong(NotificationRules.KEY_CREATED_AT, 0L)
        val read = prefs.getBoolean(NotificationRules.KEY_READ, false)

        status.text = buildString {
            append(if (read) "Đã đọc" else "Chưa đọc")
            append("\nPhiên bản: ")
            append(versionName.ifBlank { "build $versionCode" })
            append(" (")
            append(versionCode)
            append(")")
            if (createdAt > 0L) {
                append("\nGhi nhận cục bộ: ")
                append(createdAt)
            }
            if (notes.isNotBlank()) {
                append("\n\n")
                append(notes)
            }
        }
        markReadButton.isEnabled = NotificationRules.unreadCount(versionCode, read) > 0
        clearButton.isEnabled = true
    }

    private fun renderEmpty() {
        status.text = "Chưa có thông báo cập nhật V2 trên thiết bị."
        markReadButton.isEnabled = false
        clearButton.isEnabled = false
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()

    private fun currentVersionCode(): Long {
        val info = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
            return 0L
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    }
}
