package ai.tigeriq.camera

import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlin.math.abs

class FloatingCameraService : Service(), DisplayManager.DisplayListener {

    companion object {
        private const val TAG = "FloatingCamService"
        private const val CHANNEL_ID = "tigeriq_camera_floating"
        private const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            val intent = Intent(context, FloatingCameraService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to start FloatingCameraService", t)
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, FloatingCameraService::class.java))
            } catch (_: Throwable) {}
        }
    }

    private lateinit var settings: CameraSettings
    private val handler = Handler(Looper.getMainLooper())
    private var displayManager: DisplayManager? = null
    private var usbManager: UsbManager? = null
    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var currentDisplayId = -1

    // Headless background probe for auto-detecting reverse video when camera is closed
    private var signalMonitor: UvcSignalMonitor? = null
    private val backgroundVideoClassifier = VideoSignalClassifier(activeSamples = 2, idleSamples = 4)
    private var isProbeActive = false

    private val resumeVideoProbe = Runnable {
        if (settings.isReverseAutoStart && !CameraOverlayController.isShowing() && !isProbeActive) {
            val um = usbManager ?: return@Runnable
            val hasUvc = um.deviceList?.values?.any { UsbUvcManager.isUvc(it) } == true
            if (hasUvc) {
                isProbeActive = true
                backgroundVideoClassifier.reset()
                signalMonitor?.start()
                CameraEventLog.record(this, "VIDEO_PROBE", "RESUMED", "background_observer_active")
            }
        }
    }

    private fun requestVideoProbe(delayMs: Long = 800L) {
        handler.removeCallbacks(resumeVideoProbe)
        if (!settings.isReverseAutoStart || CameraOverlayController.isShowing()) return
        handler.postDelayed(resumeVideoProbe, delayMs)
    }

    private fun stopVideoProbe() {
        handler.removeCallbacks(resumeVideoProbe)
        isProbeActive = false
        signalMonitor?.stop()
    }

    // Reverse gear dynamic broadcast receiver for Android 12+
    private var dynamicReverseReceiver: BroadcastReceiver? = null

    // Background USB camera presence watcher
    private var lastCameraPresent = false
    private var isWatcherInitialized = false
    private val usbWatcherRunnable = object : Runnable {
        override fun run() {
            checkCameraPresence()
            handler.postDelayed(this, 400) // Poll every 400ms for instant tail-light response
        }
    }

    override fun onCreate() {
        super.onCreate()
        settings = CameraSettings(this)
        usbManager = getSystemService(Context.USB_SERVICE) as? UsbManager
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        displayManager = getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
        displayManager?.let {
            it.registerDisplayListener(this, handler)
        }

        // Setup headless probe
        signalMonitor = UvcSignalMonitor(this) { metrics ->
            val next = backgroundVideoClassifier.accept(metrics)
            if (next == VideoSignalClassifier.State.VIDEO_ACTIVE && !CameraOverlayController.isShowing()) {
                Log.i(TAG, "Headless probe detected VIDEO_ACTIVE -> Auto-opening Camera Overlay")
                CameraEventLog.record(this, "VIDEO_SIGNAL", "VIDEO_ACTIVE",
                    "mean=${metrics.meanLuma} var=${metrics.lumaVariance} bins=${metrics.occupiedLumaBins}")
                stopVideoProbe()
                val targetDisplay = findDexDisplay()
                CameraOverlayController.show(this@FloatingCameraService, targetDisplay, isReverse = true)
            }
        }

        CameraOverlayController.setOnOverlayClosedListener {
            requestVideoProbe(800L)
        }

        registerDynamicReverseReceiver()
        startUsbCameraWatcher()
        updateFloatingView()
        requestVideoProbe(1200L)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        updateFloatingView()
        requestVideoProbe(800L)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun registerDynamicReverseReceiver() {
        if (dynamicReverseReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent == null) return
                val action = intent.action ?: ""
                val targetDisplay = findDexDisplay()
                val displayId = targetDisplay?.displayId ?: -1

                if (action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
                    val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    val isCamera = device == null || UsbUvcManager.isUvc(device) ||
                            (device.vendorId == 0xff02 && device.productId == 0xafa1)
                    if (isCamera) {
                        requestVideoProbe(400L)
                        if (settings.isUsbAutoStart) {
                            Log.i(TAG, "Dynamic USB Attached (Tail-light R=ON) -> Auto-opening Camera Overlay")
                            if (Settings.canDrawOverlays(this@FloatingCameraService)) {
                                stopVideoProbe()
                                CameraOverlayController.show(this@FloatingCameraService, targetDisplay, isReverse = true)
                            } else {
                                CameraActivity.launch(this@FloatingCameraService, displayId, reverseActive = true)
                            }
                        }
                    }
                    return
                }

                if (action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                    val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    val isCamera = device == null || UsbUvcManager.isUvc(device) ||
                            (device.vendorId == 0xff02 && device.productId == 0xafa1)
                    if (isCamera) {
                        stopVideoProbe()
                        if (settings.isReverseImmediateClose) {
                            Log.i(TAG, "Dynamic USB Detached (Tail-light R=OFF) -> Auto-closing Camera")
                            CameraOverlayController.hide()
                            CameraActivity.dismissIfRunning(immediate = true)
                            try {
                                sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                            } catch (_: Throwable) {}
                        }
                    }
                    return
                }

                if (!settings.isReverseAutoStart) return
                val isReverse = ReverseGearReceiver.parseIsReverse(intent)
                val steering = intent.getFloatExtra("steering", 0f)

                if (isReverse) {
                    Log.i(TAG, "DynamicReceiver: Reverse ON -> Opening Camera Overlay")
                    stopVideoProbe()
                    if (Settings.canDrawOverlays(this@FloatingCameraService)) {
                        CameraOverlayController.show(this@FloatingCameraService, targetDisplay, isReverse = true, steering = steering)
                    } else {
                        CameraActivity.launch(this@FloatingCameraService, displayId, reverseActive = true, steering = steering)
                    }
                } else {
                    Log.i(TAG, "DynamicReceiver: Reverse OFF -> Closing Camera immediately")
                    CameraOverlayController.hide()
                    CameraActivity.dismissIfRunning(immediate = true)
                    requestVideoProbe(800L)
                    try {
                        sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                    } catch (_: Throwable) {}
                }
            }
        }
        val filter = IntentFilter()
        for (action in ReverseGearReceiver.REVERSE_ACTIONS) {
            filter.addAction(action)
        }
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
            } else {
                registerReceiver(receiver, filter)
            }
            dynamicReverseReceiver = receiver
            Log.i(TAG, "Registered dynamic reverse receiver successfully")
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to register dynamic reverse receiver", t)
        }
    }

    private fun startUsbCameraWatcher() {
        handler.removeCallbacks(usbWatcherRunnable)
        handler.post(usbWatcherRunnable)
        Log.i(TAG, "UsbCameraWatcher started (interval 400ms)")
    }

    private fun checkCameraPresence() {
        val um = usbManager ?: return
        val deviceList = um.deviceList ?: return

        var cameraConnected = false
        for ((_, device) in deviceList) {
            if (UsbUvcManager.isUvc(device) || (device.vendorId == 0xff02 && device.productId == 0xafa1)) {
                cameraConnected = true
                break
            }
        }

        if (!isWatcherInitialized) {
            isWatcherInitialized = true
            lastCameraPresent = cameraConnected
            if (cameraConnected && !CameraOverlayController.isShowing()) {
                requestVideoProbe(500L)
            }
            return
        }

        if (cameraConnected != lastCameraPresent) {
            lastCameraPresent = cameraConnected
            val targetDisplay = findDexDisplay()
            val displayId = targetDisplay?.displayId ?: -1

            if (cameraConnected) {
                Log.i(TAG, "Tail-light turned ON -> Camera USB became present")
                requestVideoProbe(300L)
                if (settings.isUsbAutoStart) {
                    if (Settings.canDrawOverlays(this)) {
                        stopVideoProbe()
                        CameraOverlayController.show(this, targetDisplay, isReverse = true)
                    } else {
                        CameraActivity.launch(this, displayId, reverseActive = true)
                    }
                }
            } else {
                Log.i(TAG, "Tail-light turned OFF -> Camera USB disappeared")
                stopVideoProbe()
                if (settings.isReverseImmediateClose) {
                    CameraOverlayController.hide()
                    CameraActivity.dismissIfRunning(immediate = true)
                    try {
                        sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                    } catch (_: Throwable) {}
                }
            }
        }
    }

    private fun findDexDisplay(): Display? {
        val dm = displayManager ?: return null
        val displays = dm.displays
        for (display in displays) {
            if (display.displayId != Display.DEFAULT_DISPLAY) {
                return display
            }
        }
        return dm.getDisplay(Display.DEFAULT_DISPLAY)
    }

    @Synchronized
    private fun updateFloatingView() {
        if (!settings.isFloatingEnabled) {
            removeFloatingView()
            return
        }

        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Overlay permission not granted, skipping floating view creation")
            return
        }

        val targetDisplay = findDexDisplay() ?: return
        val displayId = targetDisplay.displayId

        if (floatingView != null && currentDisplayId == displayId) {
            return
        }

        removeFloatingView()
        currentDisplayId = displayId

        val displayContext = createDisplayContext(targetDisplay)
        val ctx: Context = if (Build.VERSION.SDK_INT >= 31) {
            try {
                displayContext.createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
            } catch (t: Throwable) {
                Log.w(TAG, "createWindowContext fallback: ${t.message}")
                displayContext
            }
        } else {
            displayContext
        }

        val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        val inflater = LayoutInflater.from(ctx)
        val view = inflater.inflate(R.layout.view_floating_button, null)
        floatingView = view

        val density = ctx.resources.displayMetrics.density
        val btnSize = (64 * density).toInt()

        val initialX = settings.getFloatingX(displayId, (20 * density).toInt())
        val initialY = settings.getFloatingY(displayId, (180 * density).toInt())

        val params = WindowManager.LayoutParams(
            btnSize,
            btnSize,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = initialX
            y = initialY
        }
        layoutParams = params

        attachTouchListener(view, params, displayId)

        try {
            wm.addView(view, params)
            Log.i(TAG, "Floating button added to display $displayId at ($initialX, $initialY)")
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to add floating view to display $displayId", t)
        }
    }

    private fun attachTouchListener(view: View, params: WindowManager.LayoutParams, displayId: Int) {
        val dragSlop = ViewConfiguration.get(this).scaledTouchSlop
        var downTime = 0L
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var isDragging = false

        view.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downTime = SystemClock.uptimeMillis()
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = params.x
                    startY = params.y
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    val dist = Math.hypot(dx.toDouble(), dy.toDouble()).toFloat()
                    if (dist > dragSlop) {
                        isDragging = true
                    }
                    if (isDragging) {
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        try {
                            windowManager?.updateViewLayout(view, params)
                        } catch (_: Throwable) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (isDragging) {
                        settings.setFloatingPosition(displayId, params.x, params.y)
                    } else {
                        val duration = SystemClock.uptimeMillis() - downTime
                        if (duration >= 500L) {
                            // Long-press (>= 0.5s): Open Settings Activity
                            Log.i(TAG, "Floating button LONG-PRESS -> Launching MainActivity Settings")
                            val intent = Intent(this, MainActivity::class.java).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            }
                            try {
                                val opts = ActivityOptions.makeBasic()
                                if (displayId >= 0) {
                                    opts.launchDisplayId = displayId
                                }
                                startActivity(intent, opts.toBundle())
                            } catch (_: Throwable) {
                                startActivity(intent)
                            }
                        } else {
                            // Tap (< 0.5s): Toggle Camera Window ON / OFF
                            val targetDisplay = findDexDisplay()
                            if (Settings.canDrawOverlays(this)) {
                                CameraOverlayController.toggle(this, targetDisplay)
                                CameraActivity.dismissIfRunning(immediate = true)
                            } else {
                                if (CameraActivity.isRunning()) {
                                    Log.i(TAG, "Floating button TAP -> Camera running, closing immediately")
                                    CameraActivity.dismissIfRunning(immediate = true)
                                    try {
                                        sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                                    } catch (_: Throwable) {}
                                } else {
                                    Log.i(TAG, "Floating button TAP -> Camera not running, launching camera")
                                    CameraActivity.launch(this, displayId = displayId, reverseActive = false)
                                }
                            }
                        }
                    }
                    true
                }
                else -> false
            }
        }
    }

    @Synchronized
    private fun removeFloatingView() {
        floatingView?.let {
            try {
                windowManager?.removeView(it)
            } catch (t: Throwable) {
                Log.w(TAG, "Failed to remove floating view", t)
            }
        }
        floatingView = null
        windowManager = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.floating_service_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.floating_service_desc)
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Nút nổi Camera đang sẵn sàng trên DeX")
            .setSmallIcon(R.drawable.ic_camera_floating)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    override fun onDisplayAdded(displayId: Int) {
        handler.post { updateFloatingView() }
    }

    override fun onDisplayRemoved(displayId: Int) {
        if (displayId == currentDisplayId) {
            handler.post { updateFloatingView() }
        }
    }

    override fun onDisplayChanged(displayId: Int) {
        if (displayId == currentDisplayId || currentDisplayId == -1) {
            handler.post { updateFloatingView() }
        }
    }

    override fun onDestroy() {
        stopVideoProbe()
        signalMonitor = null
        CameraOverlayController.destroyOverlay()
        handler.removeCallbacks(usbWatcherRunnable)
        displayManager?.unregisterDisplayListener(this)
        dynamicReverseReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Throwable) {}
        }
        removeFloatingView()
        super.onDestroy()
    }
}
