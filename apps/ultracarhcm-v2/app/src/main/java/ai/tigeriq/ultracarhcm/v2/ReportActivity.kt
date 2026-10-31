package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ReportActivity : ComponentActivity() {
    private val prefs by lazy {
        getSharedPreferences(TaxiMeterRules.PREFS_NAME, Context.MODE_PRIVATE)
    }
    private lateinit var summaryView: TextView
    private lateinit var recentView: TextView

    private val exportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        if (uri != null) writeCsv(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    override fun onResume() {
        super.onResume()
        if (::summaryView.isInitialized) refresh()
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

        body.addView(text("BÁO CÁO CHUYẾN V2", 28f).apply {
            gravity = Gravity.START
        })
        body.addView(text(
            "Báo cáo dùng duy nhất lịch sử Taxi Meter do V2 ghi trên thiết bị. " +
                "Không đọc dữ liệu V1, không chứa credential và không tuyên bố tương đương mẫu XLS của V1.",
            14f,
            Color.LTGRAY,
        ))

        summaryView = text("", 18f)
        body.addView(summaryView)

        recentView = text("", 14f, Color.LTGRAY)
        body.addView(recentView)

        body.addView(Button(this).apply {
            text = "XUẤT CSV"
            setOnClickListener {
                exportLauncher.launch(ReportRules.exportFileName())
            }
        })

        body.addView(text(
            "Tệp được ghi qua Android Storage Access Framework vào vị trí người dùng chọn; " +
                "ứng dụng không yêu cầu quyền truy cập bộ nhớ diện rộng.",
            13f,
            Color.LTGRAY,
        ))

        refresh()
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

    private fun refresh() {
        val rows = readRows()
        val summary = ReportRules.summary(rows)
        val number = NumberFormat.getNumberInstance(Locale("vi", "VN"))

        summaryView.text = buildString {
            append("Tổng chuyến: ").append(summary.tripCount)
            append("\nTổng quãng đường: ")
            append(String.format(Locale.US, "%.2f km", summary.distanceMeters / 1000.0))
            append("\nTổng thời gian: ").append(formatDuration(summary.durationSeconds))
            append("\nDoanh thu ghi nhận: ").append(number.format(summary.fareVnd)).append(" VND")
        }

        if (rows.isEmpty()) {
            recentView.text = "Chưa có chuyến Taxi Meter V2 để báo cáo."
            return
        }

        val dateFormat = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("vi", "VN"))
        recentView.text = rows.take(10).joinToString("\n") { row ->
            val whenText = dateFormat.format(Date(row.startedAtEpochMs))
            val km = String.format(Locale.US, "%.2f km", row.distanceMeters / 1000.0)
            "$whenText • $km • ${formatDuration(row.durationSeconds)} • " +
                "${number.format(row.fareVnd)} VND"
        }
    }

    private fun readRows(): List<TripReportRow> {
        val history = try {
            JSONArray(prefs.getString(TaxiMeterRules.KEY_HISTORY, "[]") ?: "[]")
        } catch (_: Exception) {
            return emptyList()
        }

        val rows = ArrayList<TripReportRow>(history.length())
        for (index in 0 until history.length()) {
            val item = history.optJSONObject(index) ?: continue
            val startedAt = exactLong(item.opt("startedAt")) ?: continue
            val duration = exactLong(item.opt("durationSeconds")) ?: continue
            val distance = exactDouble(item.opt("distanceMeters")) ?: continue
            val rate = exactDouble(item.opt("rateVndPerKm")) ?: continue
            val fare = exactLong(item.opt("fareVnd")) ?: continue
            if (startedAt < 0L || duration < 0L || distance < 0.0 || rate <= 0.0 || fare < 0L) continue
            rows += TripReportRow(startedAt, duration, distance, rate, fare)
        }
        return rows
    }

    private fun exactLong(value: Any?): Long? {
        val number = value as? Number ?: return null
        val doubleValue = number.toDouble()
        if (!doubleValue.isFinite()) return null
        val longValue = number.toLong()
        return longValue.takeIf { doubleValue == longValue.toDouble() }
    }

    private fun exactDouble(value: Any?): Double? =
        (value as? Number)?.toDouble()?.takeIf { it.isFinite() }

    private fun writeCsv(uri: Uri) {
        try {
            val rows = readRows()
            val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
            val csv = ReportRules.buildCsv(rows) { epoch ->
                dateFormat.format(Date(epoch))
            }
            val stream = contentResolver.openOutputStream(uri, "wt")
                ?: throw IllegalStateException("Không mở được tệp báo cáo")
            stream.bufferedWriter(Charsets.UTF_8).use { it.write(csv) }
            toast("Đã xuất báo cáo chuyến V2")
        } catch (error: Exception) {
            android.util.Log.e("UltraCarV2", "Report export failed", error)
            toast("Không thể xuất báo cáo chuyến")
        }
    }

    private fun formatDuration(seconds: Long): String {
        val safe = seconds.coerceAtLeast(0L)
        val hours = safe / 3600L
        val minutes = (safe % 3600L) / 60L
        val remaining = safe % 60L
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, remaining)
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()

}
