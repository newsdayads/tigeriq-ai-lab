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

        registerDynamicReverseReceiver()
        startUsbCameraWatcher()
        updateFloatingView()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        updateFloatingView()
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
                    val isCamera = device != null && UsbUvcManager.isUvc(device)
                    if (isCamera && settings.isUsbAutoStart) {
                        Log.i(TAG, "Dynamic USB Attached (Tail-light R=ON) -> Auto-opening Camera")
                        CameraActivity.launch(this@FloatingCameraService, displayId, reverseActive = true)
                    }
                    return
                }

                if (action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                    val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    val isCamera = device != null && UsbUvcManager.isUvc(device)
                    if (isCamera && settings.isReverseImmediateClose) {
                        Log.i(TAG, "Dynamic USB Detached (Tail-light R=OFF) -> Auto-closing Camera")
                        CameraActivity.dismissIfRunning(immediate = true)
                        try {
                            sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                        } catch (_: Throwable) {}
                    }
                    return
                }

                if (!settings.isReverseAutoStart) return
                val isReverse = ReverseGearReceiver.parseIsReverse(intent)
                settings.recordReverseSignal(action, isReverse)
                val steering = intent.getFloatExtra("steering", 0f)

                if (isReverse) {
                    Log.i(TAG, "DynamicReceiver: Reverse ON -> Opening Camera")
                    CameraActivity.launch(this@FloatingCameraService, displayId, reverseActive = true, steering = steering)
                } else {
                    Log.i(TAG, "DynamicReceiver: Reverse OFF -> Closing Camera immediately")
                    CameraActivity.dismissIfRunning(immediate = true)
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
        if (!settings.isUsbAutoStart) return
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
            settings.recordUsbState(cameraConnected, changed = false)
            // A camera already connected at service startup is not proof of reverse gear.
            // Do not open a window on app launch, initial attach state or service restart.
            // Only a *new* USB transition or an explicit reverse broadcast may trigger it.
            Log.i(TAG, "UsbCameraWatcher initial state: present=$cameraConnected; waiting for transition/R")
            return
        }

        if (cameraConnected != lastCameraPresent) {
            lastCameraPresent = cameraConnected
            settings.recordUsbState(cameraConnected, changed = true)
            val targetDisplay = findDexDisplay()
            val displayId = targetDisplay?.displayId ?: -1

            if (cameraConnected) {
                Log.i(TAG, ">>> UsbCameraWatcher: Camera CONNECTED (Tail-light R=ON) -> Auto-opening Camera")
                CameraActivity.launch(this, displayId = displayId, reverseActive = true)
            } else {
                Log.i(TAG, ">>> UsbCameraWatcher: Camera DISCONNECTED (Tail-light R=OFF) -> Auto-closing Camera immediately")
                CameraActivity.dismissIfRunning(immediate = true)
                try {
                    sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                } catch (_: Throwable) {}
            }
        }
    }

    private fun findDexDisplay(): Display? {
        val dm = displayManager ?: return null
        try {
            // Priority 1: Samsung DeX desktop category display
            val desktopDisplays = dm.getDisplays("com.samsung.android.hardware.display.category.DESKTOP")
            if (!desktopDisplays.isNullOrEmpty() && desktopDisplays[0].isValid) {
                return desktopDisplays[0]
            }

            // Priority 2: Any valid external non-default display
            val allDisplays = dm.displays
            val external = allDisplays.firstOrNull { it.displayId != Display.DEFAULT_DISPLAY && it.isValid }
            if (external != null) return external

            // Priority 3: Default display
            return dm.getDisplay(Display.DEFAULT_DISPLAY)
        } catch (t: Throwable) {
            Log.w(TAG, "Error resolving display", t)
            return dm.getDisplay(Display.DEFAULT_DISPLAY)
        }
    }

    @Synchronized
    private fun updateFloatingView() {
        if (!settings.isFloatingEnabled) {
            removeFloatingView()
            currentDisplayId = -1
            return
        }

        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Cannot draw overlays: permission not granted")
            return
        }

        val targetDisplay = findDexDisplay() ?: run {
            removeFloatingView()
            currentDisplayId = -1
            return
        }

        val displayId = targetDisplay.displayId
        if (floatingView != null && currentDisplayId == displayId) {
            return // already attached on this display
        }

        removeFloatingView()
        currentDisplayId = displayId

        try {
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

            windowManager = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager

            val size = (64f * resources.displayMetrics.density).toInt()
            val initialX = settings.getFloatingX(displayId, 40)
            val initialY = settings.getFloatingY(displayId, 320)

            val params = WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = initialX
                y = initialY
            }
            layoutParams = params

            val view = LayoutInflater.from(ctx).inflate(R.layout.view_floating_button, null)
            attachTouchListener(view, params, displayId)

            windowManager?.addView(view, params)
            floatingView = view
            Log.i(TAG, "Floating Avatar attached to DeX display #$displayId at ($initialX, $initialY)")
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to attach floating view to display $displayId", t)
        }
    }

    private fun attachTouchListener(view: View, params: WindowManager.LayoutParams, displayId: Int) {
        val dragSlop = 28f * resources.displayMetrics.density
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var downTime = 0L
        var isDragging = false

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = params.x
                    startY = params.y
                    downTime = SystemClock.uptimeMillis()
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
        handler.removeCallbacks(usbWatcherRunnable)
        displayManager?.unregisterDisplayListener(this)
        dynamicReverseReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Throwable) {}
        }
        removeFloatingView()
        super.onDestroy()
    }
}
