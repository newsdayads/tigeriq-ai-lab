package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.graphics.Color
import android.view.Gravity
import android.view.KeyEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.util.Log

/**
 * All remote changes require an explicit user action. Accessibility permission
 * must be enabled by the owner in Android Settings; no hidden permission grants.
 */
class RemoteKeyConfigActivity : Activity() {
    private val preferences by lazy {
        getSharedPreferences(RemoteKeyRules.PREFS, Context.MODE_PRIVATE)
    }
    private lateinit var state: TextView
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 30, 28, 20)
            setBackgroundColor(0xFF13161B.toInt())
        }
        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)
        label("PHÍM BLUETOOTH VÔ LĂNG", 21f)
        state = label("", 14f)
        button("MỞ QUYỀN TRỢ NĂNG ANDROID") {
            try {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            } catch (error: RuntimeException) {
                Log.e("UltraCarV2Remote", "Accessibility settings unavailable", error)
                toast("Không mở được Cài đặt trợ năng Android")
            }
        }
        button("BẬT / TẮT ĐIỀU KHIỂN") {
            val next = !preferences.getBoolean(RemoteKeyRules.ENABLED, false)
            if (!preferences.edit().putBoolean(RemoteKeyRules.ENABLED, next).commit()) {
                toast("Không lưu được trạng thái điều khiển")
            }
            refresh()
        }
        button("CHỌN PHÍM BLUETOOTH") {
            val keys = RemoteKeyRules.allowedKeys
            val labels = keys.map { "${RemoteKeyRules.keyLabel(it)} (${it})" }.toTypedArray()
            AlertDialog.Builder(this).setTitle("Chọn phím đã ghép đôi")
                .setItems(labels) { _, index -> saveKey(keys[index]) }.show()
        }
        button("HỌC PHÍM TỪ ĐIỀU KHIỂN") {
            if (!RemoteKeyAccessibilityService.learnNext { key ->
                    runOnUiThread {
                        if (!isFinishing && !isDestroyed) saveKey(key)
                    }
                }) {
                toast("Hãy cấp quyền trợ năng cho UltraCar V2 trước")
            } else {
                toast("Nhấn một phím media / âm lượng trên remote")
            }
        }
        button("THỜI GIAN GIỮ PHÍM") {
            val values = longArrayOf(350L, 500L, 700L, 1000L, 1500L)
            val labels = values.map { "${it} ms" }.toTypedArray()
            AlertDialog.Builder(this).setTitle("Giữ phím để bật/tắt Camera")
                .setItems(labels) { _, index ->
                    if (!preferences.edit().putLong(RemoteKeyRules.HOLD_MS, values[index]).commit()) {
                        toast("Không lưu được thời gian giữ")
                    }
                    refresh()
                }.show()
        }
        label(
            "Nhấn ngắn: giữ chức năng media / âm lượng. Giữ lâu: bật/tắt Camera USB thật. " +
                "Chỉ chặn các phím an toàn đã chọn. Không can thiệp HOME, BACK hoặc số R. " +
                "Android phải cấp quyền trợ năng thủ công; kiểm thử trên remote thật trước khi dùng trên xe.",
            13f,
        )
        refresh()
    }

    private fun saveKey(code: Int) {
        if (!RemoteKeyRules.safeToMap(code)) {
            toast("Phím không thuộc nhóm an toàn")
            return
        }
        if (!preferences.edit().putInt(RemoteKeyRules.TARGET_KEY, code).commit()) {
            toast("Không lưu được phím Bluetooth")
        }
        refresh()
    }

    private fun refresh() {
        val enabled = preferences.getBoolean(RemoteKeyRules.ENABLED, false)
        val key = preferences.getInt(RemoteKeyRules.TARGET_KEY, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        val holdMs = RemoteKeyRules.holdDuration(
            preferences.getLong(RemoteKeyRules.HOLD_MS, RemoteKeyRules.DEFAULT_HOLD_MS),
        )
        state.text =
            "Dịch vụ: " + (if (RemoteKeyAccessibilityService.connectedNow()) "Đang được Android kết nối" else "Chưa cấp quyền / chưa kết nối") +
            "\nĐiều khiển: " + (if (enabled) "BẬT" else "TẮT") +
            "\nPhím: " + RemoteKeyRules.keyLabel(key) + " ($key)" +
            "\nGiữ: $holdMs ms"
    }

    override fun onResume() {
        super.onResume()
        if (::state.isInitialized) refresh()
    }

    override fun onStop() {
        RemoteKeyAccessibilityService.cancelLearn()
        super.onStop()
    }

    private fun label(value: String, size: Float): TextView {
        val view = TextView(this).apply {
            text = value
            textSize = size
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, 12, 0, 14)
        }
        root.addView(view)
        return view
    }

    private fun button(value: String, click: () -> Unit) {
        root.addView(Button(this).apply {
            text = value
            setOnClickListener { click() }
        })
    }

    private fun toast(value: String) = Toast.makeText(this, value, Toast.LENGTH_SHORT).show()
}
