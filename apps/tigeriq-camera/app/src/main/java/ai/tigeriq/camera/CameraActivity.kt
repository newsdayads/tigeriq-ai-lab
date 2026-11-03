package ai.tigeriq.camera

import android.Manifest
import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.hardware.usb.UsbDevice
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.TextureView
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

class CameraActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_REVERSE_ACTIVE = "ai.tigeriq.camera.extra.REVERSE_ACTIVE"
        const val EXTRA_STEERING_DEGREES = "ai.tigeriq.camera.extra.STEERING_DEGREES"
        const val EXTRA_AUTO_DISMISS = "ai.tigeriq.camera.extra.AUTO_DISMISS"
        const val ACTION_CLOSE_CAMERA = "ai.tigeriq.camera.action.CLOSE_CAMERA"
        private const val REQ_CAMERA_PERMISSION = 101

        private var currentInstance = WeakReference<CameraActivity>(null)

        @Volatile
        private var isRunningFlag: Boolean = false

        fun isRunning(): Boolean {
            val act = currentInstance.get()
            return isRunningFlag && act != null && !act.isFinishing && !act.isDestroyed
        }

        fun launch(context: Context, displayId: Int = -1, reverseActive: Boolean = false, steering: Float = 0f): Boolean {
            CameraEventLog.record(context, "WINDOW", "OPEN_REQUEST",
                "reverse=" + reverseActive + " | display=" + displayId)
            val intent = Intent(context, CameraActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(EXTRA_REVERSE_ACTIVE, reverseActive)
                putExtra(EXTRA_STEERING_DEGREES, steering)
            }
            try {
                val options = ActivityOptions.makeBasic()
                if (displayId >= 0) {
                    options.launchDisplayId = displayId
                }
                context.startActivity(intent, options.toBundle())
                CameraEventLog.record(context, "WINDOW", "START_REQUEST_DISPATCHED", "display=" + displayId)
                return true
            } catch (t: Throwable) {
                CameraEventLog.record(context, "WINDOW", "LAUNCH_DISPLAY_FAILED", t.javaClass.simpleName)
                Log.w("TigerIQ_Camera", "Failed to launch on display $displayId, falling back", t)
                try {
                    context.startActivity(intent)
                    CameraEventLog.record(context, "WINDOW", "FALLBACK_DISPATCHED", "display=default")
                    return true
                } catch (fallback: Throwable) {
                    CameraEventLog.record(context, "WINDOW", "FALLBACK_FAILED", fallback.javaClass.simpleName)
                    Log.e("TigerIQ_Camera", "Background launch rejected; check visible DeX/overlay context", fallback)
                    return false
                }
            }
        }

        fun dismissIfRunning(immediate: Boolean = true) {
            val wasRunning = isRunning()
            currentInstance.get()?.let {
                CameraEventLog.record(it, "WINDOW", "CLOSE_REQUEST", "running=" + wasRunning)
            }
            isRunningFlag = false
            val act = currentInstance.get()
            if (act != null && !act.isFinishing && !act.isDestroyed) {
                act.runOnUiThread {
                    if (immediate || act.settings.isReverseImmediateClose) {
                        act.finish()
                    } else {
                        act.finishWithGrace()
                    }
                }
            }
        }
    }

    private lateinit var settings: CameraSettings
    private var uvcManager: UsbUvcManager? = null
    private val handler = Handler(Looper.getMainLooper())
    private var autoDismissRunnable: Runnable? = null

    private lateinit var guideView: DynamicGuideView
    private lateinit var tvGearBadge: TextView
    private lateinit var tvStatusMessage: TextView
    private lateinit var btnToggleGuide: ImageButton
    private lateinit var btnNightBooster: ImageButton
    private lateinit var btnToggleSound: ImageButton
    private lateinit var btnSettings: ImageButton
    private lateinit var btnClose: ImageButton
    private var parkAssistEngine: ParkAssistAudioEngine? = null

    private lateinit var cardPermissionPrompt: LinearLayout
    private lateinit var tvPromptTitle: TextView
    private lateinit var tvPromptDesc: TextView
    private lateinit var btnGrantUsb: Button
    private lateinit var btnOpenSettingsPrompt: Button

    private val closeReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_CLOSE_CAMERA) {
                Log.i("TigerIQ_Camera", "Received ACTION_CLOSE_CAMERA broadcast -> Finishing CameraActivity")
                finish()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        currentInstance = WeakReference(this)
        isRunningFlag = false // Only onResume confirms a visible running Activity.
        CameraEventLog.record(this, "WINDOW", "ACTIVITY_CREATED", "camera_ui")
        setContentView(R.layout.activity_camera)

        settings = CameraSettings(this)
        if (settings.isFloatingEnabled || settings.isReverseAutoStart) {
            FloatingCameraService.start(this)
        }

        guideView = findViewById(R.id.dynamicGuideView)
        tvGearBadge = findViewById(R.id.tvGearBadge)
        tvStatusMessage = findViewById(R.id.tvStatusMessage)
        btnToggleGuide = findViewById(R.id.btnToggleGuide)
        btnNightBooster = findViewById(R.id.btnNightBooster)
        btnToggleSound = findViewById(R.id.btnToggleSound)
        btnSettings = findViewById(R.id.btnSettings)
        btnClose = findViewById(R.id.btnClose)
        val btnTopClose: ImageButton? = findViewById(R.id.btnTopClose)
        btnTopClose?.setOnClickListener { finish() }

        parkAssistEngine = ParkAssistAudioEngine(settings)
        applyNightBooster(settings.isNightBoosterEnabled)
        updateButtonStates()

        cardPermissionPrompt = findViewById(R.id.cardPermissionPrompt)
        tvPromptTitle = findViewById(R.id.tvPromptTitle)
        tvPromptDesc = findViewById(R.id.tvPromptDesc)
        btnGrantUsb = findViewById(R.id.btnGrantUsb)
        btnOpenSettingsPrompt = findViewById(R.id.btnOpenSettingsPrompt)

        guideView.isGuideVisible = settings.isGuidelinesEnabled

        checkAndRequestCameraPermission()

        // Initialize UVC Engine with permission callback
        uvcManager = UsbUvcManager(
            activity = this,
            textureView = findViewById(R.id.cameraTextureView),
            onStatus = { message, _ ->
                runOnUiThread {
                    tvStatusMessage.text = message
                }
            },
            onPermissionRequired = { device, hasPermission ->
                runOnUiThread {
                    handleUsbPermissionState(device, hasPermission)
                }
            }
        )

        setupControls()
        processIntent(intent)

        try {
            val filter = android.content.IntentFilter(ACTION_CLOSE_CAMERA)
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(closeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(closeReceiver, filter)
            }
        } catch (_: Throwable) {}
    }

    private fun checkAndRequestCameraPermission() {
        val permissions = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.CAMERA)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECORD_AUDIO)
        }
        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissions.toTypedArray(),
                REQ_CAMERA_PERMISSION
            )
        }
    }

    private fun handleUsbPermissionState(device: UsbDevice?, hasPermission: Boolean) {
        if (hasPermission) {
            cardPermissionPrompt.visibility = View.GONE
        } else {
            cardPermissionPrompt.visibility = View.VISIBLE
            val devName = device?.productName ?: device?.deviceName ?: "Camera UVC"
            tvPromptTitle.text = "CẦN CẤP QUYỀN: $devName"
            tvPromptDesc.text = "Hệ thống cần quyền USB để hiển thị hình ảnh từ $devName."
        }
    }

    private fun setupControls() {
        btnGrantUsb.setOnClickListener {
            uvcManager?.requestUsbPermissionDirectly()
        }

        btnOpenSettingsPrompt.setOnClickListener {
            startActivity(Intent(this, MainActivity::class.java))
        }

        btnSettings.setOnClickListener {
            startActivity(Intent(this, MainActivity::class.java))
        }

        // 1-touch Quick Guideline Style Toggle
        btnToggleGuide.setOnClickListener {
            val nextStyle = (settings.guidelineStyle + 1) % CameraSettings.TOTAL_STYLES
            settings.guidelineStyle = nextStyle
            settings.isGuidelinesEnabled = true
            guideView.isGuideVisible = true
            guideView.invalidate()
            val styleName = when (nextStyle) {
                CameraSettings.STYLE_SPORT_OEM -> "Sport OEM"
                CameraSettings.STYLE_PORSCHE_GT -> "Porsche GT HUD"
                CameraSettings.STYLE_AUDI_MATRIX -> "Audi Matrix Cyber"
                CameraSettings.STYLE_TESLA_CYBER -> "Tesla Cyber Vision"
                CameraSettings.STYLE_LUXURY_GOLD -> "Maybach Luxury Gold"
                else -> "Sport OEM"
            }
            tvStatusMessage.text = "Kiểu vạch: $styleName"
            Toast.makeText(this, "Đã chọn: $styleName", Toast.LENGTH_SHORT).show()
            updateButtonStates()
        }

        btnToggleGuide.setOnLongClickListener {
            val nextState = !guideView.isGuideVisible
            guideView.isGuideVisible = nextState
            settings.isGuidelinesEnabled = nextState
            updateButtonStates()
            Toast.makeText(this, if (nextState) "Vạch lùi: BẬT" else "Vạch lùi: TẮT", Toast.LENGTH_SHORT).show()
            true
        }

        // Night Booster Toggle
        btnNightBooster.setOnClickListener {
            val nextState = !settings.isNightBoosterEnabled
            settings.isNightBoosterEnabled = nextState
            applyNightBooster(nextState)
            updateButtonStates()
            tvStatusMessage.text = if (nextState) "Tăng sáng ban đêm: BẬT" else "Tăng sáng ban đêm: TẮT"
            Toast.makeText(this, if (nextState) "Night Booster: BẬT" else "Night Booster: TẮT", Toast.LENGTH_SHORT).show()
        }

        // Park Assist Sonar Sound Beep Toggle
        btnToggleSound.setOnClickListener {
            val nextState = !settings.isParkAssistBeepEnabled
            settings.isParkAssistBeepEnabled = nextState
            if (nextState && tvGearBadge.text == "R") {
                parkAssistEngine?.start()
            } else {
                parkAssistEngine?.stop()
            }
            updateButtonStates()
            tvStatusMessage.text = if (nextState) "Âm thanh hỗ trợ: BẬT" else "Âm thanh hỗ trợ: TẮT"
            Toast.makeText(this, if (nextState) "Âm thanh hỗ trợ: BẬT" else "Âm thanh hỗ trợ: TẮT", Toast.LENGTH_SHORT).show()
        }

        btnClose.setOnClickListener {
            finish()
        }
    }

    private fun updateButtonStates() {
        btnNightBooster.setColorFilter(if (settings.isNightBoosterEnabled) 0xFF00E5FF.toInt() else Color.WHITE)
        btnToggleSound.setColorFilter(if (settings.isParkAssistBeepEnabled) 0xFF00E5FF.toInt() else Color.DKGRAY)
        btnToggleGuide.alpha = if (settings.isGuidelinesEnabled) 1.0f else 0.4f
    }

    private fun applyNightBooster(enabled: Boolean) {
        val textureView: TextureView = findViewById(R.id.cameraTextureView)
        if (enabled) {
            val cm = ColorMatrix().apply {
                val c = 1.25f
                val b = 40f
                set(floatArrayOf(
                    c, 0f, 0f, 0f, b,
                    0f, c, 0f, 0f, b,
                    0f, 0f, c, 0f, b,
                    0f, 0f, 0f, 1f, 0f
                ))
            }
            val paint = Paint().apply {
                colorFilter = ColorMatrixColorFilter(cm)
            }
            textureView.setLayerType(View.LAYER_TYPE_HARDWARE, paint)
        } else {
            textureView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }
    }

    override fun onNewIntent(intent: Intent) {
        CameraEventLog.record(this, "WINDOW", "NEW_INTENT", "existing_window")
        super.onNewIntent(intent)
        setIntent(intent)
        processIntent(intent)
    }

    private fun processIntent(intent: Intent?) {
        if (intent == null) return

        if (intent.getBooleanExtra(EXTRA_AUTO_DISMISS, false)) {
            finishWithGrace()
            return
        }

        val reverseActive = intent.getBooleanExtra(EXTRA_REVERSE_ACTIVE, false)
        val steering = intent.getFloatExtra(EXTRA_STEERING_DEGREES, 0f)

        if (reverseActive) {
            cancelAutoDismiss()
            tvGearBadge.text = "R"
            tvGearBadge.setBackgroundColor(0xFFFF3B30.toInt())
            guideView.setSteeringDegrees(steering)
            if (settings.isParkAssistBeepEnabled) {
                parkAssistEngine?.start()
            }
        } else {
            tvGearBadge.text = "CAM"
            tvGearBadge.setBackgroundColor(0xFF00D2FF.toInt())
            guideView.setSteeringDegrees(0f)
            parkAssistEngine?.stop()
        }
    }

    fun finishWithGrace() {
        cancelAutoDismiss()
        parkAssistEngine?.stop()
        tvStatusMessage.text = "Đã rời chế độ Camera. Sẽ đóng sau 3 giây."
        autoDismissRunnable = Runnable {
            if (!isFinishing) finish()
        }
        handler.postDelayed(autoDismissRunnable!!, 3000)
    }

    private fun cancelAutoDismiss() {
        autoDismissRunnable?.let { handler.removeCallbacks(it) }
        autoDismissRunnable = null
    }

    private val usbPresenceWatcher = object : Runnable {
        override fun run() {
            if (!isFinishing && !isDestroyed && settings.isReverseImmediateClose) {
                val um = getSystemService(Context.USB_SERVICE) as? android.hardware.usb.UsbManager
                val list = um?.deviceList?.values
                val hasCamera = list?.any { UsbUvcManager.isUvc(it) } == true
                if (!hasCamera) {
                    CameraEventLog.record(this@CameraActivity, "WINDOW", "NO_UVC_CLOSE",
                        "usb_absent_not_necessarily_R_OFF")
                    Log.i("TigerIQ_Camera", "CameraActivity Watcher: No UVC camera detected (Tail-light R=OFF) -> Auto-closing")
                    finish()
                    return
                }
            }
            handler.postDelayed(this, 350)
        }
    }

    override fun onResume() {
        super.onResume()
        currentInstance = WeakReference(this)
        isRunningFlag = true
        CameraEventLog.record(this, "WINDOW", "ACTIVITY_RESUMED", "visible_lifecycle")
        checkAndRequestCameraPermission()
        applyNightBooster(settings.isNightBoosterEnabled)
        updateButtonStates()
        uvcManager?.start()
        // An absent camera at startup does not prove a real R -> P transition.
        handler.removeCallbacks(usbPresenceWatcher)
    }

    override fun onPause() {
        super.onPause()
        isRunningFlag = false // The activity is not actually foreground-visible.
        CameraEventLog.record(this, "WINDOW", "ACTIVITY_PAUSED", "visible=false")
        handler.removeCallbacks(usbPresenceWatcher)
        parkAssistEngine?.stop()
        uvcManager?.stop()
    }

    override fun onDestroy() {
        CameraEventLog.record(this, "WINDOW", "ACTIVITY_DESTROYED", "finishing=" + isFinishing)
        super.onDestroy()
        isRunningFlag = false
        handler.removeCallbacks(usbPresenceWatcher)
        try {
            unregisterReceiver(closeReceiver)
        } catch (_: Throwable) {}
        cancelAutoDismiss()
        parkAssistEngine?.release()
        parkAssistEngine = null
        uvcManager?.release()
        uvcManager = null
        if (currentInstance.get() == this) {
            currentInstance.clear()
        }
    }
}
