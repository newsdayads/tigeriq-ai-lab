package ai.tigeriq.camera

import android.app.Activity
import android.app.Application
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.SurfaceTexture
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import android.view.TextureView
import com.herohan.uvcapp.CameraException
import com.herohan.uvcapp.CameraHelper
import com.herohan.uvcapp.ICameraHelper
import com.serenegiant.utils.UVCUtils

/**
 * Dedicated controller for USB UVC Cameras using UVCAndroid engine.
 * Provides instant preview, automatic USB permission negotiation, and safe lifecycle recovery.
 */
class UsbUvcManager(
    private val context: Context,
    private val textureView: TextureView,
    private val onStatus: (message: String, isConnected: Boolean) -> Unit,
    private val onPermissionRequired: (device: UsbDevice, hasPermission: Boolean) -> Unit,
    private val onDeviceDisconnected: (() -> Unit)? = null
) : ICameraHelper.StateCallback, TextureView.SurfaceTextureListener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var cameraHelper: CameraHelper? = null
    var selectedDevice: UsbDevice? = null
        private set
    private var previewSurface: Surface? = null
    var isRequested = false
        private set
    private var isPreviewStarted = false

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
                            onStatus("Quyền USB đã cấp. Đang mở Camera…", false)
                            cameraHelper?.selectDevice(device)
                        } else {
                            onStatus("Chưa có quyền USB. Bấm để cấp quyền.", false)
                        }
                    }
                }
            }
        }
    }

    companion object {
        private const val TAG = "UsbUvcManager"

        fun isUvc(device: UsbDevice?): Boolean {
            if (device == null) return false
            // Standard USB Video Class
            if (device.deviceClass == 14) return true
            // Miscellaneous / composite devices (e.g. video + audio streaming)
            if (device.deviceClass == 239) return true

            // Known Hardware Capture Card IDs (e.g. AFN_CAP / MacroSilicon / USB3.0 HDMI)
            if (device.vendorId == 0xff02 && device.productId == 0xafa1) return true
            if (device.vendorId == 0x534d && device.productId == 0x2109) return true // MS2109
            if (device.vendorId == 0x534d && device.productId == 0x0021) return true

            val name = ((device.productName ?: "") + " " + (device.deviceName ?: "")).lowercase()
            if (name.contains("cam") || name.contains("video") || name.contains("uvc") ||
                name.contains("capture") || name.contains("grabber") || name.contains("afn_cap")) {
                return true
            }

            for (i in 0 until device.interfaceCount) {
                val itf = device.getInterface(i)
                if (itf.interfaceClass == 14) return true
                if (itf.interfaceClass == 239 && itf.interfaceSubclass == 2) return true
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
                context.registerReceiver(usbPermissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(usbPermissionReceiver, filter)
            }
            isReceiverRegistered = true
        }
    }

    private fun unregisterReceiver() {
        if (isReceiverRegistered) {
            try {
                context.unregisterReceiver(usbPermissionReceiver)
            } catch (_: Throwable) {}
            isReceiverRegistered = false
        }
    }

    fun start() {
        if (isRequested) return
        isRequested = true
        Log.i(TAG, "Starting UVC Camera helper...")
        onStatus("Đang khởi động kết nối Camera USB…", false)

        try {
            val app = (context.applicationContext as? Application)
            if (app != null) {
                UVCUtils.init(app)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "UVCUtils init error", t)
        }

        if (cameraHelper == null) {
            cameraHelper = CameraHelper().apply {
                setStateCallback(this@UsbUvcManager)
            }
        }

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val deviceList = usbManager.deviceList.values
        val uvcTarget = deviceList.firstOrNull { isUvc(it) }

        if (uvcTarget != null) {
            selectDevice(uvcTarget)
        } else {
            onStatus("Đang chờ Camera UVC qua USB Host…", false)
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
        onStatus("Camera đã đóng", false)
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
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val hasPerm = usbManager.hasPermission(device)

        onPermissionRequired(device, hasPerm)

        if (!hasPerm) {
            onStatus("Đã phát hiện Camera. Đang xin quyền USB…", false)
            requestUsbPermissionDirectly(device)
            try {
                cameraHelper?.selectDevice(device)
            } catch (t: Throwable) {
                Log.w(TAG, "cameraHelper.selectDevice permission trigger", t)
            }
            return
        }

        try {
            onStatus("Đã có quyền USB. Đang mở Camera…", false)
            cameraHelper?.selectDevice(device)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to select device", t)
            selectedDevice = null
            onStatus("Lỗi mở Camera: ${t.localizedMessage}", false)
        }
    }

    fun requestUsbPermissionDirectly(device: UsbDevice? = selectedDevice) {
        val target = device ?: return
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        if (usbManager.hasPermission(target)) {
            onPermissionRequired(target, true)
            onStatus("Đã có quyền USB. Đang kết nối…", false)
            cameraHelper?.selectDevice(target)
            return
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val permissionIntent = PendingIntent.getBroadcast(
            context,
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
            helper.startPreview()
            isPreviewStarted = true
            onStatus("Camera UVC đang hoạt động", true)
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
        mainHandler.post {
            if (isUvc(device)) {
                onStatus("Đã phát hiện thiết bị UVC: ${device.productName ?: device.deviceName}", false)
                if (selectedDevice == null) {
                    selectDevice(device)
                }
            }
        }
    }

    override fun onDeviceOpen(device: UsbDevice, isFirstOpen: Boolean) {
        Log.i(TAG, "Camera Device Opened: ${device.deviceName}")
        if (isRequested && device == selectedDevice) {
            try {
                cameraHelper?.openCamera()
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to call cameraHelper.openCamera()", t)
                onStatus("Lỗi mở camera: ${t.localizedMessage}", false)
            }
        }
    }

    override fun onCameraOpen(device: UsbDevice) {
        Log.i(TAG, "Camera Opened: ${device.deviceName}")
        mainHandler.post {
            selectedDevice = device
            startPreview()
        }
    }

    override fun onCameraClose(device: UsbDevice) {
        Log.i(TAG, "Camera Closed: ${device.deviceName}")
        mainHandler.post {
            if (device == selectedDevice) {
                releasePreview()
                selectedDevice = null
                onStatus("Camera UVC đã đóng — đang chờ kết nối lại", false)
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
                onStatus("USB Camera ngắt kết nối (Đã về P/D)", false)
                val settings = CameraSettings(context)
                if (settings.isReverseImmediateClose) {
                    onDeviceDisconnected?.invoke()
                    if (context is Activity && !context.isFinishing) {
                        Log.i(TAG, "Auto-closing CameraActivity on Device Close (P/D disengaged)")
                        context.finish()
                    }
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
                onStatus("Camera ngắt nguồn đèn lùi (Đã về P/D) — Đang đóng…", false)
                val settings = CameraSettings(context)
                if (settings.isReverseImmediateClose) {
                    onDeviceDisconnected?.invoke()
                    if (context is Activity && !context.isFinishing) {
                        Log.i(TAG, "Auto-closing CameraActivity on USB Detach (P/D disengaged)")
                        context.finish()
                    }
                }
            }
        }
    }

    override fun onCancel(device: UsbDevice) {
        Log.w(TAG, "USB Permission Cancelled: ${device.deviceName}")
        mainHandler.post {
            if (isRequested && device == selectedDevice) {
                onPermissionRequired(device, false)
                onStatus("Quyền truy cập USB bị từ chối", false)
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
