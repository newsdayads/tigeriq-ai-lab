package ai.tigeriq.ultracarhcm.v2

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import java.util.Locale

class TelemetryActivity : ComponentActivity(), LocationListener {
    private lateinit var batteryStatus: TextView
    private lateinit var locationStatus: TextView
    private lateinit var refreshButton: Button

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        refreshLocation()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
        refreshTelemetry()
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()
        fun statusText(): TextView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 18f
            setPadding(0, dp(10), 0, dp(10))
        }

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(10, 20, 26))
        }
        body.addView(TextView(this).apply {
            text = "GPS / Pin / Chẩn đoán"
            setTextColor(Color.WHITE)
            textSize = 28f
            gravity = Gravity.START
        })
        body.addView(TextView(this).apply {
            text = "Telemetry V2 dùng trực tiếp Android API. Weather chưa kết nối vì chưa có provider V1/endpoint được xác minh."
            setTextColor(Color.LTGRAY)
            textSize = 14f
            setPadding(0, dp(8), 0, dp(16))
        })

        batteryStatus = statusText()
        locationStatus = statusText()
        body.addView(batteryStatus)
        body.addView(locationStatus)
        body.addView(statusText().apply {
            text = "Thời tiết: chưa có nguồn dữ liệu được xác minh"
        })

        refreshButton = Button(this).apply {
            text = "Làm mới telemetry"
            setOnClickListener {
                if (hasLocationPermission()) {
                    refreshTelemetry()
                } else {
                    locationPermissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        ),
                    )
                }
            }
        }
        body.addView(
            refreshButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        body.addView(Button(this).apply {
            text = "OBD Bluetooth"
            setOnClickListener {
                startActivity(Intent(this@TelemetryActivity, ObdActivity::class.java))
            }
        })
        body.addView(Button(this).apply {
            text = "Taxi Meter"
            setOnClickListener {
                startActivity(Intent(this@TelemetryActivity, TaxiMeterActivity::class.java))
            }
        })

        return ScrollView(this).apply { addView(body) }
    }

    private fun refreshTelemetry() {
        refreshBattery()
        refreshLocation()
    }

    private fun refreshBattery() {
        val batteryIntent = registerReceiver(
            null,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED),
        )
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val percent = TelemetryRules.batteryPercent(level, scale)
        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL

        batteryStatus.text = if (percent == null) {
            "Pin thiết bị: không đọc được"
        } else {
            "Pin thiết bị: $percent% • " + if (charging) "đang sạc" else "không sạc"
        }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun refreshLocation() {
        if (!hasLocationPermission()) {
            locationStatus.text = "GPS: cần quyền vị trí khi đang dùng ứng dụng"
            refreshButton.text = "Cấp quyền GPS"
            return
        }

        refreshButton.text = "Làm mới telemetry"
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
        ).filter { provider ->
            try {
                manager.isProviderEnabled(provider)
            } catch (_: Exception) {
                false
            }
        }

        val lastKnown = providers
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (_: SecurityException) {
                    null
                }
            }
            .maxByOrNull { it.time }

        if (lastKnown != null) {
            showLocation(lastKnown, "vị trí gần nhất")
        } else {
            locationStatus.text = if (providers.isEmpty()) {
                "GPS: dịch vụ vị trí đang tắt"
            } else {
                "GPS: đang chờ vị trí"
            }
        }

        val provider = when {
            LocationManager.GPS_PROVIDER in providers -> LocationManager.GPS_PROVIDER
            LocationManager.NETWORK_PROVIDER in providers -> LocationManager.NETWORK_PROVIDER
            else -> null
        } ?: return

        try {
            manager.removeUpdates(this)
            @Suppress("DEPRECATION")
            manager.requestSingleUpdate(provider, this, Looper.getMainLooper())
        } catch (error: SecurityException) {
            locationStatus.text = "GPS: quyền vị trí không còn hiệu lực"
        } catch (error: IllegalArgumentException) {
            locationStatus.text = "GPS: provider không khả dụng"
        }
    }

    private fun showLocation(location: Location, source: String = "vị trí mới") {
        if (!TelemetryRules.validCoordinates(location.latitude, location.longitude)) {
            locationStatus.text = "GPS: dữ liệu tọa độ không hợp lệ"
            return
        }
        val lat = String.format(Locale.US, "%.5f", location.latitude)
        val lon = String.format(Locale.US, "%.5f", location.longitude)
        val accuracy = if (location.hasAccuracy()) " • ±${location.accuracy.toInt()} m" else ""
        locationStatus.text = "GPS: $lat, $lon$accuracy • $source"
    }

    override fun onLocationChanged(location: Location) {
        showLocation(location)
    }

    override fun onProviderDisabled(provider: String) {
        locationStatus.text = "GPS: provider đã tắt"
    }

    override fun onProviderEnabled(provider: String) = Unit

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onStop() {
        try {
            (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        } catch (_: SecurityException) {
            // Permission can be revoked while the Activity is visible.
        }
        super.onStop()
    }
}
