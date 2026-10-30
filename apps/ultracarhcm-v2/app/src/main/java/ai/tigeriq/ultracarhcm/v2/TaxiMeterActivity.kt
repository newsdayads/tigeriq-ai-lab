package ai.tigeriq.ultracarhcm.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class TaxiMeterActivity : ComponentActivity(), LocationListener {
    private val prefs by lazy { getSharedPreferences(TaxiMeterRules.PREFS_NAME, Context.MODE_PRIVATE) }
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var rateInput: EditText
    private lateinit var meterStatus: TextView
    private lateinit var historyStatus: TextView
    private lateinit var toggleButton: Button

    private var running = false
    private var rateVndPerKm = 0.0
    private var distanceMeters = 0.0
    private var activeElapsedMs = 0L
    private var foregroundSegmentStartedMs = 0L
    private var tripStartedEpochMs = 0L
    private var lastLocation: Location? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.any { it }) startTrip()
    }

    private val exportReportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        if (uri != null) writeTripReport(uri)
    }

    private val tick = object : Runnable {
        override fun run() {
            updateMeterUi()
            if (running) handler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
        prefs.getString(TaxiMeterRules.KEY_RATE, null)?.let { rateInput.setText(it) }
        renderHistory()
        updateMeterUi()
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()
        fun text(size: Float, color: Int = Color.WHITE): TextView = TextView(this).apply {
            textSize = size
            setTextColor(color)
            setPadding(0, dp(8), 0, dp(8))
        }

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(10, 20, 26))
        }
        body.addView(text(28f).apply {
            this.text = "Taxi Meter V2"
            gravity = Gravity.START
        })
        body.addView(text(14f, Color.LTGRAY).apply {
            this.text = "Giá cước do Owner tự cấu hình. V2 không suy đoán biểu giá của APP gốc."
        })

        body.addView(text(14f).apply { this.text = "Giá mỗi km (VND)" })
        rateInput = EditText(this).apply {
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            hint = "Ví dụ: 7000"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
        }
        body.addView(
            rateInput,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        meterStatus = text(20f)
        body.addView(meterStatus)

        toggleButton = Button(this).apply {
            text = "Bắt đầu chuyến"
            setOnClickListener {
                if (running) finishTrip(save = true) else startTrip()
            }
        }
        body.addView(toggleButton)

        historyStatus = text(15f, Color.LTGRAY)
        body.addView(historyStatus)

        body.addView(Button(this).apply {
            text = "Xuất báo cáo chuyến CSV"
            setOnClickListener {
                exportReportLauncher.launch("UltraCarHCM_V2_Trips.csv")
            }
        })

        body.addView(Button(this).apply {
            text = "Xóa lịch sử Taxi Meter V2"
            setOnClickListener {
                prefs.edit().remove(TaxiMeterRules.KEY_HISTORY).apply()
                renderHistory()
            }
        })

        return ScrollView(this).apply { addView(body) }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startTrip() {
        if (running) return
        if (!hasLocationPermission()) {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
            )
            return
        }
        val parsedRate = TaxiMeterRules.parseRateVndPerKm(rateInput.text.toString())
        if (parsedRate == null) {
            toast("Nhập giá/km hợp lệ trước khi bắt đầu")
            return
        }

        rateVndPerKm = parsedRate
        prefs.edit().putString(TaxiMeterRules.KEY_RATE, parsedRate.toString()).apply()
        running = true
        distanceMeters = 0.0
        activeElapsedMs = 0L
        foregroundSegmentStartedMs = SystemClock.elapsedRealtime()
        tripStartedEpochMs = System.currentTimeMillis()
        lastLocation = null
        rateInput.isEnabled = false
        toggleButton.text = "Kết thúc chuyến"
        handler.removeCallbacks(tick)
        handler.post(tick)
        startLocationUpdates()
    }

    private fun enabledProviders(manager: LocationManager): List<String> =
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { provider ->
                try {
                    manager.isProviderEnabled(provider)
                } catch (_: Exception) {
                    false
                }
            }

    private fun startLocationUpdates() {
        if (!running || !hasLocationPermission()) return
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = enabledProviders(manager)
        if (providers.isEmpty()) {
            meterStatus.text = "GPS đang tắt — chưa ghi quãng đường"
            return
        }
        for (provider in providers) {
            try {
                @Suppress("DEPRECATION")
                manager.requestLocationUpdates(provider, 1000L, 1f, this, Looper.getMainLooper())
            } catch (_: SecurityException) {
                meterStatus.text = "Quyền GPS không còn hiệu lực"
                return
            } catch (_: IllegalArgumentException) {
                // Provider can disappear between the availability check and registration.
            }
        }
    }

    private fun stopLocationUpdates() {
        try {
            (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        } catch (_: SecurityException) {
            // Permission can be revoked while the trip screen is visible.
        }
        lastLocation = null
    }

    override fun onLocationChanged(location: Location) {
        if (!running || !TaxiMeterRules.validCoordinates(location.latitude, location.longitude)) return
        val previous = lastLocation
        if (previous != null) {
            val segment = TaxiMeterRules.segmentMeters(
                previous.latitude,
                previous.longitude,
                location.latitude,
                location.longitude,
            )
            if (segment != null && segment >= 0.0 && segment <= MAX_SINGLE_SEGMENT_METERS) {
                distanceMeters += segment
            }
        }
        lastLocation = Location(location)
        updateMeterUi()
    }

    private fun currentElapsedMs(): Long {
        val currentSegment = if (running && foregroundSegmentStartedMs > 0L) {
            (SystemClock.elapsedRealtime() - foregroundSegmentStartedMs).coerceAtLeast(0L)
        } else {
            0L
        }
        return activeElapsedMs + currentSegment
    }

    private fun closeForegroundSegment() {
        if (foregroundSegmentStartedMs > 0L) {
            activeElapsedMs +=
                (SystemClock.elapsedRealtime() - foregroundSegmentStartedMs).coerceAtLeast(0L)
            foregroundSegmentStartedMs = 0L
        }
    }

    private fun updateMeterUi() {
        val seconds = TaxiMeterRules.elapsedSeconds(currentElapsedMs())
        val fare = TaxiMeterRules.fareVnd(rateVndPerKm, distanceMeters) ?: 0L
        val number = NumberFormat.getNumberInstance(Locale("vi", "VN"))
        meterStatus.text = buildString {
            append("Quãng đường: ")
            append(String.format(Locale.US, "%.2f km", distanceMeters / 1000.0))
            append("\nThời gian chạy foreground: ")
            append(formatDuration(seconds))
            append("\nTạm tính: ")
            append(number.format(fare))
            append(" VND")
        }
    }

    private fun finishTrip(save: Boolean) {
        if (!running) return
        closeForegroundSegment()
        stopLocationUpdates()
        handler.removeCallbacks(tick)
        running = false
        rateInput.isEnabled = true
        toggleButton.text = "Bắt đầu chuyến"

        if (save) {
            val fare = TaxiMeterRules.fareVnd(rateVndPerKm, distanceMeters) ?: 0L
            val record = JSONObject()
                .put("startedAt", tripStartedEpochMs)
                .put("durationSeconds", TaxiMeterRules.elapsedSeconds(activeElapsedMs))
                .put("distanceMeters", distanceMeters)
                .put("rateVndPerKm", rateVndPerKm)
                .put("fareVnd", fare)
            prependHistory(record)
            renderHistory()
        }
        updateMeterUi()
    }

    private fun history(): JSONArray = try {
        JSONArray(prefs.getString(TaxiMeterRules.KEY_HISTORY, "[]") ?: "[]")
    } catch (_: Exception) {
        JSONArray()
    }

    private fun prependHistory(record: JSONObject) {
        val old = history()
        val next = JSONArray().put(record)
        val limit = minOf(old.length(), TaxiMeterRules.MAX_HISTORY - 1)
        for (index in 0 until limit) {
            old.optJSONObject(index)?.let(next::put)
        }
        prefs.edit().putString(TaxiMeterRules.KEY_HISTORY, next.toString()).apply()
    }

    private fun writeTripReport(uri: Uri) {
        try {
            val entries = history()
            val out = StringBuilder()
            out.append('\uFEFF')
            out.append(ReportRules.header()).append('\n')
            val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
            for (index in 0 until entries.length()) {
                val item = entries.optJSONObject(index) ?: continue
                val cells = listOf(
                    dateFormat.format(Date(item.optLong("startedAt", 0L))),
                    item.optLong("durationSeconds", 0L).toString(),
                    item.optDouble("distanceMeters", 0.0).toString(),
                    item.optDouble("rateVndPerKm", 0.0).toString(),
                    item.optLong("fareVnd", 0L).toString(),
                )
                out.append(cells.joinToString(",") { ReportRules.csvCell(it) }).append('\n')
            }
            val stream = contentResolver.openOutputStream(uri, "wt")
                ?: throw IllegalStateException("Không mở được tệp báo cáo")
            stream.bufferedWriter(Charsets.UTF_8).use { it.write(out.toString()) }
            toast("Đã xuất báo cáo chuyến V2")
        } catch (error: Exception) {
            android.util.Log.e("UltraCarV2", "Trip report export failed", error)
            toast("Không thể xuất báo cáo chuyến")
        }
    }

    private fun renderHistory() {
        val entries = history()
        var revenue = 0L
        for (index in 0 until entries.length()) {
            revenue += entries.optJSONObject(index)?.optLong("fareVnd", 0L) ?: 0L
        }
        val number = NumberFormat.getNumberInstance(Locale("vi", "VN"))
        val lines = mutableListOf<String>()
        lines += "Lịch sử: ${entries.length()} chuyến • Doanh thu ghi nhận: ${number.format(revenue)} VND"
        val shown = minOf(entries.length(), 10)
        for (index in 0 until shown) {
            val item = entries.optJSONObject(index) ?: continue
            val whenText = SimpleDateFormat("dd/MM HH:mm", Locale("vi", "VN"))
                .format(Date(item.optLong("startedAt", 0L)))
            val km = item.optDouble("distanceMeters", 0.0) / 1000.0
            val seconds = item.optLong("durationSeconds", 0L)
            val fare = item.optLong("fareVnd", 0L)
            lines += "$whenText • ${String.format(Locale.US, "%.2f km", km)} • " +
                "${formatDuration(seconds)} • ${number.format(fare)} VND"
        }
        historyStatus.text = lines.joinToString("\n")
    }

    private fun formatDuration(seconds: Long): String {
        val safe = seconds.coerceAtLeast(0L)
        val hours = safe / 3600L
        val minutes = (safe % 3600L) / 60L
        val remaining = safe % 60L
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, remaining)
    }

    override fun onResume() {
        super.onResume()
        if (running && foregroundSegmentStartedMs == 0L) {
            foregroundSegmentStartedMs = SystemClock.elapsedRealtime()
            handler.removeCallbacks(tick)
            handler.post(tick)
            startLocationUpdates()
        }
    }

    override fun onStop() {
        if (running) {
            closeForegroundSegment()
            handler.removeCallbacks(tick)
            stopLocationUpdates()
        }
        super.onStop()
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        stopLocationUpdates()
        super.onDestroy()
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()

    companion object {
        private const val MAX_SINGLE_SEGMENT_METERS = 2_000.0
    }
}
