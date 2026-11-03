package ai.tigeriq.camera

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.SurfaceTexture
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import android.view.TextureView
import com.herohan.uvcapp.CameraException
import com.herohan.uvcapp.CameraHelper
import com.herohan.uvcapp.ICameraHelper
import com.serenegiant.utils.UVCUtils
import com.serenegiant.usb.UVCCamera
import com.serenegiant.usb.IFrameCallback
import java.util.Locale

/**
 * Dedicated controller for USB UVC Cameras using UVCAndroid engine.
 * Provides instant preview, automatic USB permission negotiation, and safe lifecycle recovery.
 */
class UsbUvcManager(
    private val activity: Context,
    private val textureView: TextureView,
    private val onStatus: (message: String, isConnected: Boolean) -> Unit,
    private val onPermissionRequired: (device: UsbDevice, hasPermission: Boolean) -> Unit,
    private val onVideoMetrics: ((UvcFrameSignalEvidence.Metrics) -> Unit)? = null
) : ICameraHelper.StateCallback, TextureView.SurfaceTextureListener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var cameraHelper: CameraHelper? = null
    var selectedDevice: UsbDevice? = null
        private set
    private var previewSurface: Surface? = null
    var isRequested = false
        private set
    private var isPreviewStarted = false
    @Volatile private var latestFrameAt = 0L
    @Volatile private var lastFrameMetricsAt = 0L
    @Volatile private var lastVideoDecisionAt = 0L
    private var previewSession = 0

    /** Frame evidence only. Never uses black frames as proof of a gear change. */
    private fun attachFrameEvidence(helper: CameraHelper) {
        try {
            val preview = helper.previewSize
            val width = preview?.width ?: 0
            val height = preview?.height ?: 0
            if (width <= 0 || height <= 0) {
                CameraEventLog.record(activity, "UVC_SIGNAL", "FRAME_FORMAT_UNKNOWN", "no_preview_size")
                return
            }
            CameraEventLog.record(activity, "UVC_SIGNAL", "FRAME_MONITOR_REGISTERING",
                "size=" + width + "x" + height + " format=NV21")
            helper.setFrameCallback(IFrameCallback { bytes ->
                val now = SystemClock.elapsedRealtime()
                latestFrameAt = now
                val decisionDue = onVideoMetrics != null &&
                    now - lastVideoDecisionAt >= 300L
                val logDue = now - lastFrameMetricsAt >= 2000L
                if (decisionDue || logDue) {
                    if (decisionDue) lastVideoDecisionAt = now
                    if (logDue) lastFrameMetricsAt = now
                    val m = UvcFrameSignalEvidence.sampleNv21(bytes, width, height)
                    if (m != null) {
                        mainHandler.post {
                            if (isRequested && isPreviewStarted) {
                                if (decisionDue) onVideoMetrics?.invoke(m)
                                if (logDue) {
                                    val detail = String.format(Locale.US,
                                        "mean=%.1f variance=%.1f dark=%.2f bins=%d low_info=%s NOT_GEAR",
                                        m.meanLuma, m.lumaVariance, m.darkShare,
                                        m.occupiedLumaBins, m.lowInformation)
                                    CameraEventLog.record(activity,"UVC_SIGNAL","FRAME_METRICS",detail)
                                }
                            }
                        }
                    } else if(logDue) {
                        mainHandler.post {
                            CameraEventLog.record(activity,"UVC_SIGNAL","FRAME_FORMAT_MISMATCH",
                                "expected_luma=" + width.toLong()*height)
                        }
                    }
                }
            }, UVCCamera.PIXEL_FORMAT_NV21)
        } catch (t: Throwable) {
            CameraEventLog.record(activity, "UVC_SIGNAL", "FRAME_MONITOR_UNAVAILABLE",
                t.javaClass.simpleName)
        }
    }

    private fun verifyFrameArrival(session: Int) {
        mainHandler.postDelayed({
            if (isRequested && isPreviewStarted && session == previewSession) {
                val last = latestFrameAt
                val age = if (last == 0L) -1L else SystemClock.elapsedRealtime() - last
                CameraEventLog.record(activity, "UVC_SIGNAL",
                    if (age == -1L || age > 3500L) "NO_RECENT_FRAME" else "FRAME_RECEIVED",
                    "age_ms=" + age + " NOT_GEAR")
            }
        }, 3600L)
    }


    private val ACTION_USB_PERMISSION = "ai.tigeriq.camera.USB_PERMISSION"
    private var isReceiverRegistered = false

    private val usbPermissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (ACTION_USB_PERMISSION == intent.action) {
                synchronized(this) {
                    val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    Log.i(TAG, "USB Permission result for ${device?.deviceName}: granted=$granted")
                    if (device != null) {
                        onPermissionRequired(device, granted)
                        if (granted) {
                            onStatus("Đã cấp quyền USB. Đang khởi động Camera.", false)
                            mainHandler.post {
                                try {
                                    cameraHelper?.selectDevice(device)
                                } catch (t: Throwable) {
                                    Log.e(TAG, "selectDevice after permission grant failed", t)
                                }
                            }
                        } else {
                            onStatus("Quyền truy cập USB bị từ chối.", false)
                        }
                    }
                }
            }
        }
    }

    companion object {
        private const val TAG = "TigerIQ_UVC"
        /**
         * Match capture devices used by the original working UltraCar app,
         * including vendor-specific USB video dongles.
         * Never match arbitrary USB hubs, storage or HID devices.
         */
        fun isUvc(device: UsbDevice): Boolean {
            if (device.deviceClass == 14 || device.deviceClass == 239) return true
            if (device.vendorId == 0xff02 && device.productId == 0xafa1) return true

            val description = listOfNotNull(device.productName, device.manufacturerName)
                .joinToString(" ").lowercase()
            val hasVideoName = listOf("camera", "cam", "uvc", "video", "capture", "grabber", "afn_cap")
                .any { description.contains(it) }
            if (hasVideoName) return true

            for (i in 0 until device.interfaceCount) {
                val intf = device.getInterface(i)
                if (intf.interfaceClass == 14) return true
                if (intf.interfaceClass == 239 && intf.interfaceSubclass == 2) return true
                // Nonstandard capture devices can expose vendor-specific
                // isochronous video endpoints with USB class 0/255.
                if (intf.interfaceClass == 255) {
                    for (j in 0 until intf.endpointCount) {
                        if (intf.getEndpoint(j).type == android.hardware.usb.UsbConstants.USB_ENDPOINT_XFER_ISOC)
                            return true
                    }
                }
            }
            return false
        }
    }

    init {
        textureView.surfaceTextureListener = this
        registerReceiver()
    }

    private fun registerReceiver() {
        if (!isReceiverRegistered) {
            val filter = IntentFilter(ACTION_USB_PERMISSION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(usbPermissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                activity.registerReceiver(usbPermissionReceiver, filter)
            }
            isReceiverRegistered = true
        }
    }

    private fun unregisterReceiver() {
        if (isReceiverRegistered) {
            try {
                activity.unregisterReceiver(usbPermissionReceiver)
            } catch (_: Throwable) {}
            isReceiverRegistered = false
        }
    }

    fun start() {
        if (isRequested) return
        isRequested = true
        Log.i(TAG, "Starting UVC Camera helper...")
        onStatus("Đang khởi động kết nối Camera USB.", false)

        try {
            UVCUtils.init(activity.applicationContext as android.app.Application)
        } catch (t: Throwable) {
            Log.w(TAG, "UVCUtils init error", t)
        }

        if (cameraHelper == null) {
            cameraHelper = CameraHelper().apply {
                setStateCallback(this@UsbUvcManager)
            }
        }

        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        val deviceList = usbManager.deviceList.values
        val uvcTarget = deviceList.firstOrNull { isUvc(it) }

        if (uvcTarget != null) {
            selectDevice(uvcTarget)
        } else {
            onStatus("Đang chờ Camera UVC qua USB.", false)
        }
    }

    fun stop() {
        isRequested = false
        Log.i(TAG, "Stopping UVC Camera helper...")
        try {
            cameraHelper?.stopPreview()
            cameraHelper?.closeCamera()
        } catch (e: Throwable) {
            Log.w(TAG, "Error stopping preview", e)
        }
        releasePreview()
        selectedDevice = null
        onStatus("Camera đã dừng.", false)
    }

    fun release() {
        stop()
        unregisterReceiver()
        cameraHelper?.release()
        cameraHelper = null
        releasePreview()
    }

    private fun releasePreview() {
        isPreviewStarted = false
        previewSession++
        latestFrameAt = 0L
        lastFrameMetricsAt = 0L
        lastVideoDecisionAt = 0L
        previewSurface?.let {
            try {
                cameraHelper?.removeSurface(it)
            } catch (_: Throwable) {}
            it.release()
        }
        previewSurface = null
    }

    fun selectDevice(device: UsbDevice) {
        if (!isRequested) return
        selectedDevice = device
        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        val hasPerm = usbManager.hasPermission(device)

        onPermissionRequired(device, hasPerm)

        if (!hasPerm) {
            onStatus("Đã phát hiện Camera. Đang xin quyền USB.", false)
            requestUsbPermissionDirectly(device)
            try {
                cameraHelper?.selectDevice(device)
            } catch (t: Throwable) {
                Log.w(TAG, "cameraHelper.selectDevice permission trigger", t)
            }
            return
        }

        try {
            onStatus("Đã có quyền USB. Đang mở Camera.", false)
            cameraHelper?.selectDevice(device)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to select device", t)
            selectedDevice = null
            onStatus("Lỗi mở Camera: ${t.localizedMessage}", false)
        }
    }

    fun requestUsbPermissionDirectly(device: UsbDevice? = selectedDevice) {
        val target = device ?: return
        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        if (usbManager.hasPermission(target)) {
            onPermissionRequired(target, true)
            onStatus("Đã có quyền USB. Đang kết nối.", false)
            cameraHelper?.selectDevice(target)
            return
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val permissionIntent = PendingIntent.getBroadcast(
            activity,
            0,
            Intent(ACTION_USB_PERMISSION),
            flags
        )
        Log.i(TAG, "Directly requesting USB permission via UsbManager for: ${target.deviceName}")
        usbManager.requestPermission(target, permissionIntent)
    }

    private fun startPreview() {
        val helper = cameraHelper ?: return
        if (!isRequested || !textureView.isAvailable || isPreviewStarted || !helper.isCameraOpened) return
        try {
            val texture = textureView.surfaceTexture ?: return
            val s = Surface(texture)
            previewSurface = s
            helper.addSurface(s, false)
            latestFrameAt = 0L
            lastFrameMetricsAt = 0L
            attachFrameEvidence(helper)
            helper.startPreview()
            isPreviewStarted = true
            previewSession++
            verifyFrameArrival(previewSession)
            onStatus("Camera UVC đang hoạt động.", true)
            selectedDevice?.let { onPermissionRequired(it, true) }
            Log.i(TAG, "UVC preview successfully started")
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start preview", t)
            releasePreview()
            onStatus("Không thể mở luồng hình ảnh: ${t.localizedMessage}", false)
        }
    }

    // --- ICameraHelper.StateCallback ---

    override fun onAttach(device: UsbDevice) {
        Log.i(TAG, "USB Device Attached: ${device.deviceName}")
        if (isUvc(device) && selectedDevice == null) {
            mainHandler.post { selectDevice(device) }
        }
    }

    override fun onDeviceOpen(device: UsbDevice, isFirstOpen: Boolean) {
        Log.i(TAG, "Camera Device Opened: ${device.deviceName}")
        if (isRequested && device == selectedDevice) {
            try {
                cameraHelper?.openCamera()
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to open camera", t)
                mainHandler.post { onStatus("Không thể mở Camera.", false) }
            }
        }
    }

    override fun onCameraOpen(device: UsbDevice) {
        Log.i(TAG, "Camera Open callback: ${device.deviceName}")
        mainHandler.post {
            if (isRequested && device == selectedDevice) {
                CameraSettings(activity).rememberWorkingCamera(device)
                CameraEventLog.record(activity, "USB_VIDEO", "WORKING_CAMERA_LEARNED",
                    "VID=" + device.vendorId + " PID=" + device.productId)
                startPreview()
            }
        }
    }

    override fun onCameraClose(device: UsbDevice) {
        Log.i(TAG, "Camera Closed: ${device.deviceName}")
        mainHandler.post {
            if (device == selectedDevice) {
                releasePreview()
                selectedDevice = null
                onStatus("Camera UVC đã dừng. Đang chờ kết nối lại.", false)
            }
        }
    }

    override fun onDeviceClose(device: UsbDevice) {
        Log.i(TAG, "Device Closed: ${device.deviceName}")
        mainHandler.post {
            val isCamera = isUvc(device) || device == selectedDevice
            if (isCamera) {
                releasePreview()
                selectedDevice = null
                onStatus("USB Camera mất kết nối (không xác định số xe).", false)
                val settings = CameraSettings(activity)
                if (settings.isReverseImmediateClose && activity is CameraActivity && !activity.isFinishing) {
                    Log.i(TAG, "Auto-closing CameraActivity on Device Close (P/D disengaged)")
                    activity.finish()
                }
            }
        }
    }

    override fun onDetach(device: UsbDevice) {
        Log.i(TAG, "USB Device Detached: ${device.deviceName}")
        mainHandler.post {
            val isCamera = isUvc(device) || device == selectedDevice
            if (isCamera) {
                releasePreview()
                selectedDevice = null
                onStatus("Camera USB ngắt kết nối (không xác định P/D).", false)
                val settings = CameraSettings(activity)
                if (settings.isReverseImmediateClose && activity is CameraActivity && !activity.isFinishing) {
                    Log.i(TAG, "Auto-closing CameraActivity on USB Detach (P/D disengaged)")
                    activity.finish()
                }
            }
        }
    }

    override fun onCancel(device: UsbDevice) {
        Log.w(TAG, "USB Permission Cancelled: ${device.deviceName}")
        mainHandler.post {
            if (isRequested && device == selectedDevice) {
                onPermissionRequired(device, false)
                onStatus("Quyền truy cập USB bị từ chối.", false)
            }
        }
    }

    override fun onError(device: UsbDevice, e: CameraException) {
        Log.e(TAG, "Camera Error: ${e.message}", e)
        mainHandler.post {
            onStatus("Lỗi Camera: ${e.message}", false)
        }
    }

    // --- TextureView.SurfaceTextureListener ---

    override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        startPreview()
    }

    override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {}

    override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        releasePreview()
        return true
    }

    override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {}
}
