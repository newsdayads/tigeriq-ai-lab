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
        const val ACTION_USB_REFRESH = "ai.tigeriq.camera.action.USB_REFRESH"
        const val ACTION_GEAR_ON = "ai.tigeriq.camera.action.GEAR_OVERLAY_ON"
        const val ACTION_GEAR_OFF = "ai.tigeriq.camera.action.GEAR_OVERLAY_OFF"

        fun gear(context: Context, on: Boolean) {
            val intent = Intent(context, FloatingCameraService::class.java)
                .setAction(if (on) ACTION_GEAR_ON else ACTION_GEAR_OFF)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    context.startForegroundService(intent)
                else context.startService(intent)
            } catch(t: Throwable) {
                CameraEventLog.record(context, "WINDOW", "GEAR_SERVICE_START_FAILED",t.javaClass.simpleName)
            }
        }


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
    private lateinit var cameraOverlay: ReverseCameraOverlay

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
    // Single pending open mirrors original UltraCar v1.0.17.
    private val pendingUsbOpen = Runnable {
        CameraEventLog.record(this, "ULTRACAR_USB", "AUTO_OPEN_EXECUTING",
            "source=usb_not_proven_gear")
        if (!cameraOverlay.show(findDexDisplay())) {
            // DeX may deny overlay on a secondary display; retry default display.
            cameraOverlay.show(null)
        }
    }
    private fun openFromUsb(source: String) {
        handler.removeCallbacks(pendingUsbOpen)
        CameraEventLog.record(this, "ULTRACAR_USB", "OPEN_SCHEDULED", source + " delay=400ms")
        handler.postDelayed(pendingUsbOpen, 400L)
    }
    private fun closeFromUsb(source: String) {
        handler.removeCallbacks(pendingUsbOpen)
        CameraEventLog.record(this, "ULTRACAR_USB", "CLOSE_NOW", source)
        cameraOverlay.hide()
        CameraActivity.dismissIfRunning(immediate = true)
        sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA).setPackage(packageName))
    }
    private val usbWatcherRunnable = object : Runnable {
        override fun run() {
            checkCameraPresence()
            handler.postDelayed(this, 350L) // UltraCar v1.0.17 original
        }
    }

    override fun onCreate() {
        super.onCreate()
        settings = CameraSettings(this)
        cameraOverlay = ReverseCameraOverlay(this)
        usbManager = getSystemService(Context.USB_SERVICE) as? UsbManager
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        displayManager = getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
        displayManager?.let {
            it.registerDisplayListener(this, handler)
        }

        CameraEventLog.record(this, "SERVICE", "START",
            "reverse_auto=" + settings.isReverseAutoStart + " | usb_auto=" + settings.isUsbAutoStart)
        registerDynamicReverseReceiver()
        startUsbCameraWatcher()
        updateFloatingView()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when(intent?.action) {
            ACTION_GEAR_ON -> {
                CameraEventLog.record(this,"WINDOW","GEAR_OVERLAY_OPEN_REQUEST","manual_or_broadcast")
                handler.removeCallbacks(pendingUsbOpen)
                if (!cameraOverlay.show(findDexDisplay())) cameraOverlay.show(null)
            }
            ACTION_GEAR_OFF -> {
                CameraEventLog.record(this,"WINDOW","GEAR_OVERLAY_CLOSE_REQUEST")
                closeFromUsb("gear_off_action")
            }
        }
        updateFloatingView()
        if (intent?.action == ACTION_USB_REFRESH) {
            handler.postDelayed({ checkCameraPresence() }, 120L)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun registerDynamicReverseReceiver() {
        if (dynamicReverseReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent == null) return
                val action = intent.action ?: ""
                if (action != UsbManager.ACTION_USB_DEVICE_ATTACHED &&
                    action != UsbManager.ACTION_USB_DEVICE_DETACHED) {
                    CameraEventLog.record(this@FloatingCameraService, "SERVICE", "GEAR_RX",
                        action + " | reverse_auto=" + settings.isReverseAutoStart)
                }
                if (action == UsbManager.ACTION_USB_DEVICE_ATTACHED ||
                    action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                    CameraEventLog.record(this@FloatingCameraService, "ULTRACAR_USB",
                        "SYSTEM_BROADCAST", action)
                    handler.postDelayed({ checkCameraPresence() }, 120L)
                    return
                }

                // Gear is handled by the single manifest ReverseGearReceiver
                // using exact UltraCar source contract; no duplicate activity launch.
            }
        }
        val filter = IntentFilter()
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
            CameraEventLog.record(this, "SERVICE", "REGISTER_FAILED", t.javaClass.simpleName)
            Log.w(TAG, "Failed to register dynamic reverse receiver", t)
        }
    }

    private fun startUsbCameraWatcher() {
        handler.removeCallbacks(usbWatcherRunnable)
        handler.post(usbWatcherRunnable)
        Log.i(TAG, "UsbCameraWatcher started (interval 350ms, original UltraCar)")
    }

    // Inspect USB composite classes/endpoints; does NOT infer physical gear.
    private fun usbInterfaces(device: UsbDevice): String {
        return try {
            (0 until device.interfaceCount).joinToString(",") { i ->
                val itf = device.getInterface(i)
                val ends = (0 until itf.endpointCount).joinToString(".") { n ->
                    val ep = itf.getEndpoint(n)
                    ep.type.toString() + ":" + ep.direction
                }
                itf.interfaceClass.toString() + "/" + itf.interfaceSubclass +
                    "/" + itf.interfaceProtocol + "(" + ends + ")"
            }.take(130)
        } catch (t: Throwable) { "UNAVAILABLE_" + t.javaClass.simpleName }
    }

    private fun usbSnapshot(devices: List<UsbDevice>): String =
        devices.joinToString(";") { device ->
            device.vendorId.toString() + ":" + device.productId +
                " cls=" + device.deviceClass + " if=" + usbInterfaces(device)
        }.take(280)

    // Complete USB inventory prevents always-on DeX hubs from masking camera insertion.
    private var previousUsbKeys: Set<String> = emptySet()
    private var activeCameraDeviceKey: String? = null

    private fun checkCameraPresence() {
        if (!settings.isUsbAutoStart) return
        val um = usbManager ?: return
        val devices = try { um.deviceList?.values?.toList() ?: return }
            catch (err: Throwable) {
                CameraEventLog.record(this, "GEAR_SOURCE", "USB_ENUMERATION_FAILED",
                    err.javaClass.simpleName)
                return
            }
        val keyed = devices.associateBy { it.vendorId.toString() + ":" + it.productId + ":" + it.deviceName }
        val usbKeys = keyed.keys
        val learnedCamera = settings.workingCameraKey()
        val strictCamera = devices.firstOrNull { device ->
            learnedCamera != null &&
                (device.vendorId.toString() + ":" + device.productId) == learnedCamera
        }
        val uvcCamera = devices.firstOrNull { UsbUvcManager.isUvc(it) }
        val candidate = strictCamera ?: if (learnedCamera == null) uvcCamera else null
        val matchedKey = candidate?.let { it.vendorId.toString() + ":" + it.productId + ":" + it.deviceName }

        if (!isWatcherInitialized) {
            isWatcherInitialized = true
            previousUsbKeys = usbKeys
            activeCameraDeviceKey = matchedKey
            lastCameraPresent = matchedKey != null
            settings.recordUsbState(matchedKey != null, changed = false)
            CameraEventLog.record(this, "GEAR_SOURCE", "USB_BASELINE",
                "devices=" + devices.size + " learned=" + (learnedCamera != null) +
                " video_present=" + (matchedKey != null))
            CameraEventLog.record(this, "GEAR_SOURCE", "USB_DESCRIPTORS",
                usbSnapshot(devices))
            // USB present at startup is not physical R. The capture card can
            // remain enumerated while the vehicle is in P/N/D.
            // Only a real gear broadcast or actual USB transition may open it.
            if (matchedKey != null) CameraEventLog.record(this, "GEAR_SOURCE",
                "USB_CONNECTED_NOT_GEAR", "cold_start_suppressed")
            return
        }

        val added = usbKeys - previousUsbKeys
        val removed = previousUsbKeys - usbKeys
        previousUsbKeys = usbKeys
        if (added.isNotEmpty() || removed.isNotEmpty()) {
            CameraEventLog.record(this, "GEAR_SOURCE", "USB_INVENTORY_CHANGED",
                "added=" + added.size + " removed=" + removed.size +
                " count=" + devices.size + " devices=" + usbSnapshot(devices))
        }
        val previous = activeCameraDeviceKey
        val lost = previous != null && !usbKeys.contains(previous)
        val becamePresent = matchedKey != null && (previous == null || previous != matchedKey)
        if (lost) {
            activeCameraDeviceKey = null
            lastCameraPresent = false
            settings.recordUsbState(false, changed = true)
            closeFromUsb("recognized_camera_disappeared")
        }

        if (becamePresent) {
            activeCameraDeviceKey = matchedKey
            lastCameraPresent = true
            settings.recordUsbState(true, changed = true)
            openFromUsb("recognized_camera_connected")
            return
        }

        // Compatibility with old UltraCar's broad USB trigger:
        // when no device can be classified, a NEW USB device is the only usable
        // source. Never treat a USB hub that was already there as gear R.
        if (learnedCamera == null && matchedKey == null && previous == null &&
            added.size == 1) {
            val newDevice = keyed[added.first()]
            val notHubOrUnrelated = newDevice != null &&
                newDevice.deviceClass !in listOf(3, 8, 9) &&
                (0 until newDevice.interfaceCount).none {
                    newDevice.getInterface(it).interfaceClass in listOf(3, 8, 9)
                }
            if (newDevice != null && notHubOrUnrelated) {
                activeCameraDeviceKey = added.first()
                lastCameraPresent = true
                settings.recordUsbState(true, changed = true)
                CameraEventLog.record(this, "GEAR_SOURCE", "LEGACY_UNKNOWN_USB_TRIGGER",
                    "VID=" + newDevice.vendorId + " PID=" + newDevice.productId)
                openFromUsb("new_single_unknown_usb_device")
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
                            if (cameraOverlay.isVisible || CameraActivity.isRunning()) {
                                Log.i(TAG, "Floating button TAP -> Camera running, closing immediately")
                                cameraOverlay.hide()
                                CameraActivity.dismissIfRunning(immediate = true)
                                try {
                                    sendBroadcast(Intent(CameraActivity.ACTION_CLOSE_CAMERA))
                                } catch (_: Throwable) {}
                            } else {
                                Log.i(TAG, "Floating button TAP -> Camera not running, launching camera")
                                if (!cameraOverlay.show(findDexDisplay())) cameraOverlay.show(null)
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
            .setContentText("N?t Camera n?i ?? s?n s?ng tr?n DeX")
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
        cameraOverlay.hide()
        handler.removeCallbacks(usbWatcherRunnable)
        handler.removeCallbacks(pendingUsbOpen)
        displayManager?.unregisterDisplayListener(this)
        dynamicReverseReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Throwable) {}
        }
        removeFloatingView()
        super.onDestroy()
    }
}
