package ai.tigeriq.ultracarhcm.v2

import android.Manifest
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors

class ObdActivity : ComponentActivity() {
    companion object {
        private val SPP_UUID: UUID =
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private lateinit var connectionStatus: TextView
    private lateinit var speedStatus: TextView
    private lateinit var rpmStatus: TextView
    private lateinit var voltageStatus: TextView
    private lateinit var connectButton: Button
    private lateinit var refreshButton: Button

    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var pendingSocket: BluetoothSocket? = null
    @Volatile private var selectedDevice: BluetoothDevice? = null
    @Volatile private var activityStarted = false
    @Volatile private var connectionGeneration = 0L

    private val connectPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) showPairedDevices()
        else setConnection("OBD: cần quyền Bluetooth để dùng thiết bị đã ghép đôi")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
        updateButtons()
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()
        fun status(): TextView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 18f
            setPadding(0, dp(8), 0, dp(8))
        }

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(10, 20, 26))
        }
        body.addView(TextView(this).apply {
            text = "OBD Bluetooth"
            setTextColor(Color.WHITE)
            textSize = 28f
        })
        body.addView(TextView(this).apply {
            text = "Kết nối adapter OBD đã ghép đôi. Speed/RPM/điện áp chỉ được xác nhận sau QA adapter và xe thật."
            setTextColor(Color.LTGRAY)
            textSize = 14f
            setPadding(0, dp(8), 0, dp(16))
        })

        connectionStatus = status().apply { text = "OBD: chưa kết nối" }
        speedStatus = status().apply { text = "Tốc độ: -- km/h" }
        rpmStatus = status().apply { text = "RPM: --" }
        voltageStatus = status().apply { text = "Điện áp: -- V" }
        body.addView(connectionStatus)
        body.addView(speedStatus)
        body.addView(rpmStatus)
        body.addView(voltageStatus)

        connectButton = Button(this).apply {
            text = "Chọn thiết bị OBD đã ghép đôi"
            setOnClickListener { requestDeviceSelection() }
        }
        refreshButton = Button(this).apply {
            text = "Đọc telemetry OBD"
            isEnabled = false
            setOnClickListener { queryTelemetry() }
        }
        body.addView(connectButton)
        body.addView(refreshButton)
        body.addView(Button(this).apply {
            text = "Mở cài đặt ghép đôi Bluetooth"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            }
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

    private fun adapter(): BluetoothAdapter? =
        (getSystemService(BluetoothManager::class.java))?.adapter

    private fun hasConnectPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun requestDeviceSelection() {
        val bluetooth = adapter()
        if (bluetooth == null) {
            setConnection("OBD: thiết bị Android không hỗ trợ Bluetooth")
            return
        }
        if (!bluetooth.isEnabled) {
            setConnection("OBD: Bluetooth đang tắt")
            return
        }
        if (!hasConnectPermission()) {
            connectPermissionLauncher.launch(Manifest.permission.BLUETOOTH_CONNECT)
            return
        }
        showPairedDevices()
    }

    private fun showPairedDevices() {
        if (!hasConnectPermission()) return
        val devices = try {
            adapter()?.bondedDevices
                ?.sortedWith(compareBy<BluetoothDevice> { it.name ?: "" }.thenBy { it.address })
                .orEmpty()
        } catch (_: SecurityException) {
            setConnection("OBD: quyền Bluetooth không còn hiệu lực")
            return
        }

        if (devices.isEmpty()) {
            setConnection("OBD: chưa có thiết bị Bluetooth đã ghép đôi")
            return
        }

        val labels = devices.map { device ->
            val name = try { device.name } catch (_: SecurityException) { null }
            val address = try { device.address } catch (_: SecurityException) { "?" }
            (name ?: "Thiết bị Bluetooth") + " • " + address
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("Chọn adapter OBD")
            .setItems(labels) { _, which -> connect(devices[which]) }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun connect(device: BluetoothDevice) {
        connectionGeneration += 1L
        val generation = connectionGeneration
        disconnect()
        selectedDevice = device
        setConnection("OBD: đang kết nối…")
        updateButtons()

        worker.execute {
            var candidate: BluetoothSocket? = null
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) !=
                    PackageManager.PERMISSION_GRANTED
                ) {
                    throw SecurityException("BLUETOOTH_CONNECT missing")
                }
                val active = device.createRfcommSocketToServiceRecord(SPP_UUID)
                candidate = active
                if (!activityStarted || isFinishing || isDestroyed ||
                    generation != connectionGeneration
                ) {
                    try { active.close() } catch (_: Exception) { }
                    return@execute
                }
                pendingSocket = active
                if (!activityStarted || isFinishing || isDestroyed ||
                    generation != connectionGeneration || pendingSocket !== active
                ) {
                    if (pendingSocket === active) pendingSocket = null
                    try { active.close() } catch (_: Exception) { }
                    return@execute
                }
                active.connect()
                initializeAdapter(active)
                if (!activityStarted || isFinishing || isDestroyed ||
                    generation != connectionGeneration || pendingSocket !== active
                ) {
                    if (pendingSocket === active) pendingSocket = null
                    try { active.close() } catch (_: Exception) { }
                    return@execute
                }
                pendingSocket = null
                socket = active
                if (!activityStarted || isFinishing || isDestroyed ||
                    generation != connectionGeneration
                ) {
                    clearPublishedSocket(active)
                    return@execute
                }
                runOnUiThread {
                    if (!activityStarted || isFinishing || isDestroyed ||
                        generation != connectionGeneration || socket !== active
                    ) {
                        clearPublishedSocket(active)
                        return@runOnUiThread
                    }
                    setConnection("OBD: đã kết nối")
                    updateButtons()
                    queryTelemetry()
                }
            } catch (error: Exception) {
                if (pendingSocket === candidate) pendingSocket = null
                if (socket === candidate) {
                    disconnect()
                } else {
                    try { candidate?.close() } catch (_: Exception) { }
                }
                runOnUiThread {
                    if (activityStarted && !isFinishing && !isDestroyed &&
                        generation == connectionGeneration
                    ) {
                        setConnection("OBD: kết nối thất bại")
                        updateButtons()
                    }
                }
            }
        }
    }

    private fun initializeAdapter(active: BluetoothSocket) {
        for (command in listOf("ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0")) {
            exchange(active, command, 1500L)
        }
    }

    private fun queryTelemetry() {
        val active = socket ?: run {
            setConnection("OBD: chưa kết nối")
            updateButtons()
            return
        }
        val generation = connectionGeneration
        refreshButton.isEnabled = false
        worker.execute {
            try {
                val speed = ObdProtocol.parseSpeedKph(exchange(active, "010D"))
                val rpm = ObdProtocol.parseRpm(exchange(active, "010C"))
                val voltage = ObdProtocol.parseVoltage(exchange(active, "ATRV"))
                runOnUiThread {
                    if (!activityStarted || isFinishing || isDestroyed ||
                        generation != connectionGeneration || socket !== active
                    ) {
                        return@runOnUiThread
                    }
                    speedStatus.text = "Tốc độ: " + (speed?.toString() ?: "--") + " km/h"
                    rpmStatus.text = "RPM: " + (rpm?.toString() ?: "--")
                    voltageStatus.text = "Điện áp: " +
                        (voltage?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "--") +
                        " V"
                    updateButtons()
                }
            } catch (_: Exception) {
                val currentSession =
                    generation == connectionGeneration && socket === active
                if (currentSession) disconnect()
                runOnUiThread {
                    if (!activityStarted || isFinishing || isDestroyed ||
                        generation != connectionGeneration || !currentSession
                    ) {
                        return@runOnUiThread
                    }
                    setConnection("OBD: mất kết nối hoặc adapter không phản hồi")
                    updateButtons()
                }
            }
        }
    }

    private fun exchange(active: BluetoothSocket, command: String, timeoutMs: Long = 1200L): String {
        val output: OutputStream = active.outputStream
        output.write((command + "\r").toByteArray(Charsets.US_ASCII))
        output.flush()

        val input = active.inputStream
        val out = StringBuilder()
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val available = input.available()
            if (available > 0) {
                val buffer = ByteArray(available.coerceAtMost(256))
                val count = input.read(buffer)
                if (count > 0) {
                    out.append(String(buffer, 0, count, Charsets.US_ASCII))
                    if (out.contains(">")) break
                }
            } else {
                Thread.sleep(25L)
            }
        }
        return out.toString()
    }

    private fun setConnection(value: String) {
        connectionStatus.text = value
    }

    private fun updateButtons() {
        val connected = socket?.isConnected == true
        refreshButton.isEnabled = connected
        connectButton.text = if (connected) "Đổi thiết bị OBD" else "Chọn thiết bị OBD đã ghép đôi"
    }

    private fun clearPublishedSocket(expected: BluetoothSocket) {
        if (socket !== expected) return
        socket = null
        try { expected.close() } catch (_: Exception) { }
    }

    private fun disconnect() {
        val active = socket
        val pending = pendingSocket
        socket = null
        pendingSocket = null
        try { active?.close() } catch (_: Exception) { }
        if (pending !== active) {
            try { pending?.close() } catch (_: Exception) { }
        }
    }

    override fun onStart() {
        super.onStart()
        activityStarted = true
    }

    override fun onStop() {
        activityStarted = false
        connectionGeneration += 1L
        disconnect()
        updateButtons()
        super.onStop()
    }

    override fun onDestroy() {
        connectionGeneration += 1L
        disconnect()
        worker.shutdownNow()
        super.onDestroy()
    }
}
