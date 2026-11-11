package ai.tigeriq.camera

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var settings: CameraSettings
    private lateinit var usbManager: UsbManager

    private lateinit var tvCameraPermStatus: TextView
    private lateinit var tvOverlayPermStatus: TextView
    private lateinit var tvNotificationPermStatus: TextView

    private lateinit var btnGrantCamera: Button
    private lateinit var btnGrantOverlay: Button
    private lateinit var btnGrantNotification: Button

    private lateinit var btnRefreshUsb: Button
    private lateinit var layoutUsbDevices: LinearLayout
    private lateinit var tvNoUsbDevice: TextView

    private lateinit var switchFloating: SwitchCompat
    private lateinit var switchReverseGear: SwitchCompat
    private lateinit var switchImmediateClose: SwitchCompat
    private lateinit var switchParkAssist: SwitchCompat
    private lateinit var switchNightBooster: SwitchCompat
    private lateinit var switchGuidelines: SwitchCompat
    private lateinit var switchMotionCurve: SwitchCompat
    private lateinit var switchInvertSteering: SwitchCompat
    private lateinit var switchWheelMetricBars: SwitchCompat

    private lateinit var btnStyleSport: Button
    private lateinit var btnStylePorsche: Button
    private lateinit var btnStyleAudi: Button
    private lateinit var btnStyleTesla: Button
    private lateinit var btnStyleMaybach: Button
    private lateinit var btnStyleOemWheel: Button

    private lateinit var btnScaleNormal: Button
    private lateinit var btnScaleLarge: Button
    private lateinit var btnScaleWide: Button

    private lateinit var btnSimulateReverseOn: Button
    private lateinit var btnSimulateReverseOff: Button
    private lateinit var btnQuickToggleFloating: Button
    private lateinit var btnRestartFloating: Button
    private lateinit var btnResetFloatingPos: Button
    private lateinit var btnOpenCamera: Button

    companion object {
        private const val REQ_CAMERA = 201
        private const val REQ_NOTIFICATION = 202
        private const val ACTION_USB_PERMISSION_MAIN = "ai.tigeriq.camera.USB_PERMISSION_MAIN"
    }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_USB_PERMISSION_MAIN ||
                intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED ||
                intent?.action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                refreshUsbDeviceList()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settings = CameraSettings(this)
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager

        initViews()
        initOnlineUi()
        registerUsbReceiver()
    }

    private fun initOnlineUi() {
        val status = findViewById<TextView>(R.id.tvOnlineStatus)
        val pairing = findViewById<EditText>(R.id.editOnlinePairCode)
        status?.text = CameraOnlineBridge.status(this)
        findViewById<Button>(R.id.btnPairOnline)?.setOnClickListener {
            status?.text = "Đang ghép đôi..."
            CameraOnlineBridge.pair(this, pairing.text.toString().trim()) { result ->
                status?.text = result
                if (CameraOnlineBridge.isPaired(this)) pairing.text?.clear()
            }
        }
        findViewById<Button>(R.id.btnSyncOnline)?.setOnClickListener {
            status?.text = "Đang gửi log..."
            CameraOnlineBridge.syncNow(this) { result -> status?.text = result }
        }
        findViewById<Button>(R.id.btnCheckOnlineUpdate)?.setOnClickListener {
            status?.text = "Đang kiểm tra và tải bản mới..."
            CameraOnlineBridge.checkUpdate(this) { result -> status?.text = result }
        }
        findViewById<Button>(R.id.btnInstallOnlineUpdate)?.setOnClickListener {
            val result = CameraOnlineBridge.installReady(this)
            status?.text = result
            Toast.makeText(this, result, Toast.LENGTH_LONG).show()
        }
    }

    private fun registerUsbReceiver() {
        val filter = IntentFilter().apply {
            addAction(ACTION_USB_PERMISSION_MAIN)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(usbReceiver, filter)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(usbReceiver)
        } catch (_: Throwable) {}
    }

    override fun onResume() {
        super.onResume()
        refreshAllPermissionStatuses()
        refreshUsbDeviceList()
        findViewById<TextView>(R.id.tvOnlineStatus)?.text = CameraOnlineBridge.status(this)
        CameraOnlineBridge.schedule(this)
        if (settings.isReverseAutoStart || settings.isFloatingEnabled) {
            FloatingCameraService.start(this)
        }
        CameraEventLog.record(this, "APP", "SETTINGS_OPENED", "log_view_ready")
        val eventText = findViewById<TextView>(R.id.tvCameraEventLog)
        eventText?.text = CameraEventLog.read(this, maxChars = 4000)
        findViewById<Button>(R.id.btnRefreshCameraLog)?.setOnClickListener {
            eventText?.text = CameraEventLog.read(this, maxChars = 5000)
        }
        findViewById<Button>(R.id.btnShareCameraLog)?.setOnClickListener {
            CameraEventLog.record(this, "APP", "LOG_SHARED_BY_USER")
            val payload = "TigerIQ Camera v" + BuildConfig.VERSION_NAME + "\n" +
                settings.getReverseDiagnostics() + "\n--- Event log ---\n" +
                CameraEventLog.read(this, maxChars = 32000)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "TigerIQ Camera diagnostic log")
                putExtra(Intent.EXTRA_TEXT, payload)
            }
            try {
                startActivity(Intent.createChooser(send, "Chia sẻ nhật ký Camera"))
            } catch (error: Exception) {
                Toast.makeText(this, "Không thể chia sẻ: " + error.javaClass.simpleName,
                    Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun initViews() {
        tvCameraPermStatus = findViewById(R.id.tvCameraPermStatus)
        tvOverlayPermStatus = findViewById(R.id.tvOverlayPermStatus)
        tvNotificationPermStatus = findViewById(R.id.tvNotificationPermStatus)

        btnGrantCamera = findViewById(R.id.btnGrantCamera)
        btnGrantOverlay = findViewById(R.id.btnGrantOverlay)
        btnGrantNotification = findViewById(R.id.btnGrantNotification)

        btnRefreshUsb = findViewById(R.id.btnRefreshUsb)
        layoutUsbDevices = findViewById(R.id.layoutUsbDevices)
        tvNoUsbDevice = findViewById(R.id.tvNoUsbDevice)

        switchFloating = findViewById(R.id.switchFloating)
        switchReverseGear = findViewById(R.id.switchReverseGear)
        switchImmediateClose = findViewById(R.id.switchImmediateClose)
        switchParkAssist = findViewById(R.id.switchParkAssist)
        switchNightBooster = findViewById(R.id.switchNightBooster)
        switchGuidelines = findViewById(R.id.switchGuidelines)
        switchMotionCurve = findViewById(R.id.switchMotionCurve)
        switchInvertSteering = findViewById(R.id.switchInvertSteering)
        switchWheelMetricBars = findViewById(R.id.switchWheelMetricBars)

        btnScaleNormal = findViewById(R.id.btnScaleNormal)
        btnScaleLarge = findViewById(R.id.btnScaleLarge)
        btnScaleWide = findViewById(R.id.btnScaleWide)

        btnSimulateReverseOn = findViewById(R.id.btnSimulateReverseOn)
        btnSimulateReverseOff = findViewById(R.id.btnSimulateReverseOff)
        btnQuickToggleFloating = findViewById(R.id.btnQuickToggleFloating)
        btnRestartFloating = findViewById(R.id.btnRestartFloating)
        btnResetFloatingPos = findViewById(R.id.btnResetFloatingPos)
        btnOpenCamera = findViewById(R.id.btnOpenCamera)

        // Grant buttons
        btnGrantCamera.setOnClickListener {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                REQ_CAMERA
            )
        }

        btnGrantOverlay.setOnClickListener {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }

        btnGrantNotification.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQ_NOTIFICATION
                )
            } else {
                Toast.makeText(this, "Phiên bản Android này không yêu cầu quyền thông báo", Toast.LENGTH_SHORT).show()
            }
        }

        btnRefreshUsb.setOnClickListener {
            refreshUsbDeviceList()
        }

        // Switches state
        switchFloating.isChecked = settings.isFloatingEnabled
        switchReverseGear.isChecked = settings.isReverseAutoStart
        switchImmediateClose.isChecked = settings.isReverseImmediateClose
        switchParkAssist.isChecked = settings.isParkAssistBeepEnabled
        switchNightBooster.isChecked = settings.isNightBoosterEnabled
        switchGuidelines.isChecked = settings.isGuidelinesEnabled
        switchMotionCurve.isChecked = settings.isMotionCurveEnabled
        switchInvertSteering.isChecked = settings.isSteeringInverted
        switchWheelMetricBars.isChecked = settings.isOemWheelDistanceBarsEnabled

        switchParkAssist.setOnCheckedChangeListener { _, isChecked ->
            settings.isParkAssistBeepEnabled = isChecked
        }

        switchNightBooster.setOnCheckedChangeListener { _, isChecked ->
            settings.isNightBoosterEnabled = isChecked
        }

        switchFloating.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                if (!Settings.canDrawOverlays(this)) {
                    switchFloating.isChecked = false
                    Toast.makeText(this, R.string.permission_overlay_prompt, Toast.LENGTH_LONG).show()
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                    startActivity(intent)
                    return@setOnCheckedChangeListener
                }
                settings.isFloatingEnabled = true
                FloatingCameraService.start(this)
                btnQuickToggleFloating.text = "Tắt Nút Nổi"
            } else {
                settings.isFloatingEnabled = false
                FloatingCameraService.stop(this)
                btnQuickToggleFloating.text = "Bật Nút Nổi"
            }
        }

        btnQuickToggleFloating.text = if (settings.isFloatingEnabled) "Tắt Nút Nổi" else "Bật Nút Nổi"
        btnQuickToggleFloating.setOnClickListener {
            switchFloating.isChecked = !switchFloating.isChecked
        }

        switchReverseGear.setOnCheckedChangeListener { _, isChecked ->
            settings.isReverseAutoStart = isChecked
        }

        switchImmediateClose.setOnCheckedChangeListener { _, isChecked ->
            settings.isReverseImmediateClose = isChecked
        }

        switchGuidelines.setOnCheckedChangeListener { _, isChecked ->
            settings.isGuidelinesEnabled = isChecked
        }

        switchMotionCurve.setOnCheckedChangeListener { _, isChecked ->
            settings.isMotionCurveEnabled = isChecked
        }

        switchInvertSteering.setOnCheckedChangeListener { _, isChecked ->
            settings.isSteeringInverted = isChecked
            Toast.makeText(this, if (isChecked) "Đã đảo chiều bẻ lái" else "Hướng bẻ lái mặc định", Toast.LENGTH_SHORT).show()
        }

        switchWheelMetricBars.setOnCheckedChangeListener { _, isChecked ->
            settings.isOemWheelDistanceBarsEnabled = isChecked
        }

        // Style Buttons (6 OEM & Futuristic Styles)
        btnStyleSport = findViewById(R.id.btnStyleSport)
        btnStylePorsche = findViewById(R.id.btnStylePorsche)
        btnStyleAudi = findViewById(R.id.btnStyleAudi)
        btnStyleTesla = findViewById(R.id.btnStyleTesla)
        btnStyleMaybach = findViewById(R.id.btnStyleMaybach)
        btnStyleOemWheel = findViewById(R.id.btnStyleOemWheel)

        updateStyleButtonHighlight(settings.guidelineStyle)
        btnStyleSport.setOnClickListener {
            settings.guidelineStyle = CameraSettings.STYLE_SPORT_OEM
            updateStyleButtonHighlight(CameraSettings.STYLE_SPORT_OEM)
            Toast.makeText(this, "Đã chọn: Mẫu Sport OEM", Toast.LENGTH_SHORT).show()
        }
        btnStylePorsche.setOnClickListener {
            settings.guidelineStyle = CameraSettings.STYLE_PORSCHE_GT
            updateStyleButtonHighlight(CameraSettings.STYLE_PORSCHE_GT)
            Toast.makeText(this, "Đã chọn: Mẫu Porsche GT HUD", Toast.LENGTH_SHORT).show()
        }
        btnStyleAudi.setOnClickListener {
            settings.guidelineStyle = CameraSettings.STYLE_AUDI_MATRIX
            updateStyleButtonHighlight(CameraSettings.STYLE_AUDI_MATRIX)
            Toast.makeText(this, "Đã chọn: Mẫu Audi Matrix Cyber", Toast.LENGTH_SHORT).show()
        }
        btnStyleTesla.setOnClickListener {
            settings.guidelineStyle = CameraSettings.STYLE_TESLA_CYBER
            updateStyleButtonHighlight(CameraSettings.STYLE_TESLA_CYBER)
            Toast.makeText(this, "Đã chọn: Mẫu Tesla Cyber Vision", Toast.LENGTH_SHORT).show()
        }
        btnStyleMaybach.setOnClickListener {
            settings.guidelineStyle = CameraSettings.STYLE_LUXURY_GOLD
            updateStyleButtonHighlight(CameraSettings.STYLE_LUXURY_GOLD)
            Toast.makeText(this, "Đã chọn: Mẫu Maybach Luxury Gold", Toast.LENGTH_SHORT).show()
        }
        btnStyleOemWheel.setOnClickListener {
            settings.guidelineStyle = CameraSettings.STYLE_OEM_WHEEL
            updateStyleButtonHighlight(CameraSettings.STYLE_OEM_WHEEL)
            Toast.makeText(this, "Đã chọn: Mẫu Bánh xe OEM", Toast.LENGTH_SHORT).show()
        }

        // Scale Buttons
        updateScaleButtonHighlight(settings.guidelineScale)
        btnScaleNormal.setOnClickListener {
            settings.guidelineScale = 1.0f
            updateScaleButtonHighlight(1.0f)
            Toast.makeText(this, "Vạch lùi: Kích thước Chuẩn (1.0x)", Toast.LENGTH_SHORT).show()
        }
        btnScaleLarge.setOnClickListener {
            settings.guidelineScale = 1.25f
            updateScaleButtonHighlight(1.25f)
            Toast.makeText(this, "Vạch lùi: Kích thước To Rõ (1.25x)", Toast.LENGTH_SHORT).show()
        }
        btnScaleWide.setOnClickListener {
            settings.guidelineScale = 1.45f
            updateScaleButtonHighlight(1.45f)
            Toast.makeText(this, "Vạch lùi: Kích thước Cực Đại (1.45x)", Toast.LENGTH_SHORT).show()
        }

        // Reverse gear simulation triggers
        btnSimulateReverseOn.setOnClickListener {
            val intent = Intent(ReverseGearReceiver.ACTION_REVERSE_GEAR).apply {
                putExtra("gear", "R")
                putExtra("state", true)
            }
            sendBroadcast(intent)
            Toast.makeText(this, "Đã phát tín hiệu số R (Mở Camera)", Toast.LENGTH_SHORT).show()
        }

        btnSimulateReverseOff.setOnClickListener {
            val intent = Intent(ReverseGearReceiver.ACTION_REVERSE_GEAR).apply {
                putExtra("gear", "P")
                putExtra("state", false)
            }
            sendBroadcast(intent)
            Toast.makeText(this, "Đã phát tín hiệu rời số R (Tắt Camera)", Toast.LENGTH_SHORT).show()
        }

        btnRestartFloating.setOnClickListener {
            FloatingCameraService.stop(this)
            FloatingCameraService.start(this)
            Toast.makeText(this, "Đã khởi động lại Nút nổi trên màn hình DeX", Toast.LENGTH_SHORT).show()
        }

        btnResetFloatingPos.setOnClickListener {
            val targetDisplay = DeXDisplayHelper.resolveTargetDisplay(this)
            val dId = targetDisplay?.displayId ?: 0
            settings.setFloatingPosition(dId, 40, 320)
            FloatingCameraService.stop(this)
            FloatingCameraService.start(this)
            Toast.makeText(this, "Đã đưa Nút nổi về vị trí chuẩn mép trái", Toast.LENGTH_SHORT).show()
        }

        btnOpenCamera.setOnClickListener {
            if (Settings.canDrawOverlays(this)) {
                val targetDisplay = DeXDisplayHelper.resolveTargetDisplay(this)
                CameraOverlayController.show(this, targetDisplay, isReverse = false)
            } else {
                CameraActivity.launch(this, reverseActive = false)
            }
        }

        val tvBuildVersion: TextView? = findViewById(R.id.tvBuildVersion)
        tvBuildVersion?.text = "• Bản dựng: TigerIQ Camera v${BuildConfig.VERSION_NAME}"
    }

    private fun updateStyleButtonHighlight(style: Int) {
        val activeBg = 0xFF00E5FF.toInt()
        val inactiveBg = 0xFF1E293B.toInt()
        val activeText = 0xFF000000.toInt()
        val inactiveText = 0xFFFFFFFF.toInt()

        val buttons = mapOf(
            CameraSettings.STYLE_SPORT_OEM to btnStyleSport,
            CameraSettings.STYLE_PORSCHE_GT to btnStylePorsche,
            CameraSettings.STYLE_AUDI_MATRIX to btnStyleAudi,
            CameraSettings.STYLE_TESLA_CYBER to btnStyleTesla,
            CameraSettings.STYLE_LUXURY_GOLD to btnStyleMaybach,
            CameraSettings.STYLE_OEM_WHEEL to btnStyleOemWheel
        )

        buttons.forEach { (s, btn) ->
            btn.setBackgroundColor(if (s == style) activeBg else inactiveBg)
            btn.setTextColor(if (s == style) activeText else inactiveText)
        }
    }

    private fun updateScaleButtonHighlight(scale: Float) {
        val activeBg = 0xFF00E5FF.toInt()
        val inactiveBg = 0xFF1E293B.toInt()
        val activeText = 0xFF000000.toInt()
        val inactiveText = 0xFFFFFFFF.toInt()

        btnScaleNormal.setBackgroundColor(if (scale <= 1.05f) activeBg else inactiveBg)
        btnScaleNormal.setTextColor(if (scale <= 1.05f) activeText else inactiveText)

        btnScaleLarge.setBackgroundColor(if (scale in 1.06f..1.35f) activeBg else inactiveBg)
        btnScaleLarge.setTextColor(if (scale in 1.06f..1.35f) activeText else inactiveText)

        btnScaleWide.setBackgroundColor(if (scale > 1.35f) activeBg else inactiveBg)
        btnScaleWide.setTextColor(if (scale > 1.35f) activeText else inactiveText)
    }

    private fun refreshAllPermissionStatuses() {
        // 1. Camera permission
        val hasCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (hasCamera) {
            tvCameraPermStatus.text = "✓ ĐÃ CẤP QUYỀN CAMERA"
            tvCameraPermStatus.setTextColor(0xFF34C759.toInt())
            btnGrantCamera.visibility = View.GONE
        } else {
            tvCameraPermStatus.text = "✗ CHƯA CẤP QUYỀN"
            tvCameraPermStatus.setTextColor(0xFFFF3B30.toInt())
            btnGrantCamera.visibility = View.VISIBLE
        }

        // 2. Overlay permission
        val hasOverlay = Settings.canDrawOverlays(this)
        if (hasOverlay) {
            tvOverlayPermStatus.text = "✓ ĐÃ CẤP QUYỀN HIỂN THỊ NỔI"
            tvOverlayPermStatus.setTextColor(0xFF34C759.toInt())
            btnGrantOverlay.visibility = View.GONE
        } else {
            tvOverlayPermStatus.text = "✗ CHƯA CẤP QUYỀN"
            tvOverlayPermStatus.setTextColor(0xFFFF3B30.toInt())
            btnGrantOverlay.visibility = View.VISIBLE
        }

        // 3. Notification permission
        val hasNotification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else true

        if (hasNotification) {
            tvNotificationPermStatus.text = "✓ ĐÃ CẤP QUYỀN THÔNG BÁO"
            tvNotificationPermStatus.setTextColor(0xFF34C759.toInt())
            btnGrantNotification.visibility = View.GONE
        } else {
            tvNotificationPermStatus.text = "✗ CHƯA CẤP QUYỀN"
            tvNotificationPermStatus.setTextColor(0xFFFFCC00.toInt())
            btnGrantNotification.visibility = View.VISIBLE
        }

        // 4. Audio permission (required by USB UVC to avoid system warnings)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 203)
        }
    }

    private fun refreshUsbDeviceList() {
        val deviceMap = usbManager.deviceList
        layoutUsbDevices.removeAllViews()

        if (deviceMap.isEmpty()) {
            layoutUsbDevices.addView(tvNoUsbDevice)
            return
        }

        var foundUvc = false

        for (device in deviceMap.values) {
            val isUvc = UsbUvcManager.isUvc(device) || (device.vendorId == 0xff02 && device.productId == 0xafa1)
            if (!isUvc) continue
            foundUvc = true

            val itemLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 6, 0, 10)
            }

            val titleView = TextView(this).apply {
                val devName = device.productName ?: device.deviceName
                text = "📷 [CAMERA UVC] $devName"
                setTextColor(0xFF00E5FF.toInt())
                textSize = 13f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            }
            itemLayout.addView(titleView)

            val detailsView = TextView(this).apply {
                text = "VID: ${Integer.toHexString(device.vendorId)} | PID: ${Integer.toHexString(device.productId)} | Cổng: ${device.deviceName}"
                setTextColor(0xFF94A3B8.toInt())
                textSize = 11f
            }
            itemLayout.addView(detailsView)

            val hasPerm = usbManager.hasPermission(device)
            val permStatusView = TextView(this).apply {
                text = if (hasPerm) "✓ ĐÃ CẤP QUYỀN TRUY CẬP USB" else "✗ CHƯA CẤP QUYỀN TRUY CẬP USB"
                setTextColor(if (hasPerm) 0xFF34C759.toInt() else 0xFFFF3B30.toInt())
                textSize = 11f
                setPadding(0, 2, 0, 4)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            }
            itemLayout.addView(permStatusView)

            if (!hasPerm) {
                val btnRequest = Button(this).apply {
                    text = "Bấm xin quyền USB cho Camera này"
                    setBackgroundColor(0xFF00E5FF.toInt())
                    setTextColor(Color.BLACK)
                    textSize = 11f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    setOnClickListener {
                        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                        } else {
                            PendingIntent.FLAG_UPDATE_CURRENT
                        }
                        val permIntent = PendingIntent.getBroadcast(
                            this@MainActivity,
                            device.deviceId,
                            Intent(ACTION_USB_PERMISSION_MAIN),
                            flags
                        )
                        Toast.makeText(
                            this@MainActivity,
                            "Hãy tích [Luôn cho phép] rồi bấm OK",
                            Toast.LENGTH_LONG
                        ).show()
                        usbManager.requestPermission(device, permIntent)
                    }
                }
                itemLayout.addView(btnRequest)
            }

            val divider = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply {
                    topMargin = 8
                }
                setBackgroundColor(0x22FFFFFF)
            }
            itemLayout.addView(divider)

            layoutUsbDevices.addView(itemLayout)
        }

        if (!foundUvc) {
            layoutUsbDevices.addView(tvNoUsbDevice)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshAllPermissionStatuses()
    }
}
