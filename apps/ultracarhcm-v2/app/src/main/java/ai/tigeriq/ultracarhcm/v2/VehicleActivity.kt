package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

class VehicleActivity : ComponentActivity() {
    private val prefs by lazy {
        getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)
    }

    private lateinit var status: TextView
    private lateinit var plateInput: EditText

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
            text = "XE VÀ BIỂN SỐ"
            textSize = 26f
            setTextColor(Color.WHITE)
        })

        status = TextView(this).apply {
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(16))
        }
        body.addView(status)

        body.addView(Button(this).apply {
            text = "CHỌN LIMO ĐỎ"
            setOnClickListener { selectModel(VehicleRules.MODEL_LIMO_RED) }
        })

        body.addView(Button(this).apply {
            text = "CHỌN LAMBORGHINI TRẮNG"
            setOnClickListener { selectModel(VehicleRules.MODEL_LAMBORGHINI_WHITE) }
        })

        body.addView(TextView(this).apply {
            text = "Biển số hiển thị"
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(16), 0, dp(4))
        })

        plateInput = EditText(this).apply {
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setSingleLine(true)
            hint = "Ví dụ: 51K-123.45"
            setText(prefs.getString(VehicleRules.PREF_LICENSE_PLATE, "") ?: "")
        }
        body.addView(
            plateInput,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        body.addView(Button(this).apply {
            text = "LƯU BIỂN SỐ"
            setOnClickListener {
                val plate = VehicleRules.normalizeLicensePlate(plateInput.text.toString())
                prefs.edit().putString(VehicleRules.PREF_LICENSE_PLATE, plate).apply()
                plateInput.setText(plate)
                plateInput.setSelection(plate.length)
                refreshStatus()
                toast("Đã lưu biển số V2")
            }
        })

        body.addView(TextView(this).apply {
            text =
                "Trạng thái xe đang chạy/chuyển động của V1 chưa có nguồn hành vi đủ để tái dựng, nên V2 chưa tự giả lập."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(16), 0, dp(8))
        })

        refreshStatus()

        return ScrollView(this).apply { addView(body) }
    }

    private fun selectModel(model: String) {
        val limo = model == VehicleRules.MODEL_LIMO_RED
        prefs.edit()
            .putString(VehicleRules.PREF_MODEL, model)
            .putBoolean("limo", limo)
            .apply()
        refreshStatus()
        toast("Đã chọn ${VehicleRules.modelLabel(model)}")
    }

    private fun refreshStatus() {
        val model = VehicleRules.currentModel(
            prefs.getString(VehicleRules.PREF_MODEL, null),
            prefs.getBoolean("limo", false),
        )
        val plate = prefs.getString(VehicleRules.PREF_LICENSE_PLATE, "")
            ?.takeIf { it.isNotBlank() } ?: "Chưa đặt"
        status.text = "Xe: ${VehicleRules.modelLabel(model)}\nBiển số: $plate"
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
}
