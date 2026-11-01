package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class AppearanceActivity : ComponentActivity() {
    private val prefs by lazy {
        getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
    }

    private lateinit var status: TextView

    private val imagePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) persistCustomBackground(uri, AppearanceRules.KIND_IMAGE)
    }

    private val videoPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) persistCustomBackground(uri, AppearanceRules.KIND_VIDEO)
    }

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
            text = "GIAO DIỆN VÀ HÌNH NỀN"
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
            text = "ĐỔI NGÀY / ĐÊM"
            setOnClickListener {
                val nextNight = !prefs.getBoolean("night", false)
                if (prefs.edit().putBoolean("night", nextNight).commit()) {
                    refreshStatus()
                } else {
                    toast("Không thể lưu chế độ ngày/đêm")
                }
            }
        })

        body.addView(Button(this).apply {
            text = "CHỌN ẢNH NỀN TÙY CHỈNH"
            setOnClickListener { imagePicker.launch(arrayOf("image/*")) }
        })

        body.addView(Button(this).apply {
            text = "CHỌN VIDEO NỀN TÙY CHỈNH"
            setOnClickListener { videoPicker.launch(arrayOf("video/*")) }
        })

        body.addView(Button(this).apply {
            text = "XÓA NỀN TÙY CHỈNH"
            setOnClickListener { clearCustomBackground() }
        })

        body.addView(TextView(this).apply {
            text =
                "Ngôn ngữ và bảng màu V1 chưa được ánh xạ từ nguồn chuẩn, nên V2 chưa tự đặt thêm lựa chọn để tránh giả parity."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(16), 0, dp(8))
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

    private fun persistCustomBackground(uri: Uri, expectedKind: String) {
        val observedMime = contentResolver.getType(uri)
        if (!AppearanceRules.matchesExpectedMime(observedMime, expectedKind)) {
            toast("Không xác minh được loại tệp ảnh/video đã chọn")
            return
        }

        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (error: SecurityException) {
            android.util.Log.e("UltraCarV2", "Cannot persist custom background URI", error)
            toast("Không thể giữ quyền đọc tệp nền")
            return
        }

        val previous = prefs.getString(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI, null)
            ?.let(Uri::parse)
        val committed = prefs.edit()
            .putString(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI, uri.toString())
            .putString(AppearanceRules.PREF_CUSTOM_BACKGROUND_KIND, expectedKind)
            .commit()
        if (!committed) {
            if (previous != uri) releasePersistedUri(uri)
            toast("Không thể lưu nền tùy chỉnh V2")
            return
        }
        if (previous != null && previous != uri) releasePersistedUri(previous)
        refreshStatus()
        toast("Đã lưu nền tùy chỉnh V2")
    }

    private fun releasePersistedUri(uri: Uri) {
        try {
            contentResolver.releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (_: SecurityException) {
            // Already revoked or provider removed.
        }
    }

    private fun clearCustomBackground() {
        val previous = prefs.getString(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI, null)
            ?.let(Uri::parse)
        val committed = prefs.edit()
            .remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI)
            .remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_KIND)
            .commit()
        if (!committed) {
            toast("Không thể xóa nền tùy chỉnh V2")
            return
        }
        if (previous != null) releasePersistedUri(previous)
        refreshStatus()
        toast("Đã về nền ngày/đêm mặc định")
    }

    private fun refreshStatus() {
        val mode = AppearanceRules.modeLabel(prefs.getBoolean("night", false))
        val kind = prefs.getString(AppearanceRules.PREF_CUSTOM_BACKGROUND_KIND, null)
        val custom = when (kind) {
            AppearanceRules.KIND_IMAGE -> "Ảnh tùy chỉnh"
            AppearanceRules.KIND_VIDEO -> "Video tùy chỉnh"
            else -> "Không"
        }
        status.text = "Chế độ: $mode\nNền tùy chỉnh: $custom"
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
}
