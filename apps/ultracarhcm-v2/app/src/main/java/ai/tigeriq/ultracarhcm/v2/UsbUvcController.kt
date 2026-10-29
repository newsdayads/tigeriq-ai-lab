package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.graphics.SurfaceTexture
import android.hardware.usb.UsbDevice
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import android.view.TextureView
import com.herohan.uvcapp.CameraException
import com.herohan.uvcapp.CameraHelper
import com.herohan.uvcapp.ICameraHelper
import com.serenegiant.utils.UVCUtils

/** Genuine USB-host UVC camera path, independent of Android Camera2 external provider. */
class UsbUvcController(
    private val activity: Activity,
    private val preview: TextureView,
    private val report: (String, Boolean) -> Unit
) : ICameraHelper.StateCallback, TextureView.SurfaceTextureListener {
    private val main = Handler(Looper.getMainLooper())
    private var helper: CameraHelper? = null
    private var target: UsbDevice? = null
    private var surface: Surface? = null
    private var previewStarted = false
    private var recoveryAttempts = 0
    private var recoveryGeneration = 0L
    var requested = false
        private set
    val logTag = "UltraCarV2UVC"

    private fun isUvcDevice(device: UsbDevice): Boolean =
        device.deviceClass == 14 || (0 until device.interfaceCount)
            .any { device.getInterface(it).interfaceClass == 14 }

    private fun selectTarget(device: UsbDevice) {
        if (!requested || target != null || !isUvcDevice(device)) return
        try {
            target = device
            report("Đã tìm Camera UVC. Đang yêu cầu quyền USB…", false)
            helper?.selectDevice(device)
        } catch (t: Throwable) {
            Log.e(logTag, "UVC select failed", t)
            target = null
            stop()
            report("Không chọn được Camera UVC: ${t.javaClass.simpleName}", false)
        }
    }

    fun start() {
        if (requested) return
        requested = true
        recoveryAttempts = 0
        recoveryGeneration++
        preview.surfaceTextureListener = this
        try {
            UVCUtils.init(activity.application)
            val h = CameraHelper()
            helper = h
            h.setStateCallback(this)
            val device = h.deviceList.orEmpty().firstOrNull(::isUvcDevice)
            if (device == null) {
                report("Đang chờ Camera UVC qua USB Host — có thể cắm camera khi cửa sổ đang mở", false)
                return
            }
            selectTarget(device)
        } catch (t: Throwable) {
            Log.e(logTag, "UVC init/select failed", t)
            stop()
            report("Không khởi tạo được UVC: ${t.javaClass.simpleName}", false)
        }
    }

    private fun beginPreview() {
        val h = helper ?: return
        if (!requested || !preview.isAvailable || previewStarted || !h.isCameraOpened) return
        try {
            val texture = preview.surfaceTexture ?: return
            val s = Surface(texture)
            surface = s
            h.addSurface(s, false)
            h.startPreview()
            previewStarted = true
            recoveryAttempts = 0
            recoveryGeneration++
            report("Đang nhận hình Camera USB UVC", true)
            Log.i(logTag, "USB-host UVC preview started")
        } catch (t: Throwable) {
            Log.e(logTag, "UVC preview failed", t)
            // addSurface may already have succeeded. Release its Surface on failure.
            releasePreview()
            // Reset requested before notifying UI; otherwise its retry button stays "Close".
            stop()
            report("Lỗi hình Camera UVC: ${t.javaClass.simpleName}", false)
        }
    }

    private fun sameAttachedUvc(device: UsbDevice): UsbDevice? =
        helper?.deviceList.orEmpty().firstOrNull {
            it.deviceId == device.deviceId && isUvcDevice(it)
        }

    private fun scheduleRecovery(device: UsbDevice) {
        if (!UvcRecoveryRules.shouldSchedule(requested, target == null, recoveryAttempts)) {
            if (requested && target == null && UvcRecoveryRules.exhausted(recoveryAttempts)) {
                report("UVC chưa tự khôi phục sau ${UvcRecoveryRules.MAX_AUTOMATIC_ATTEMPTS} lần — hãy bấm thử lại hoặc rút/cắm USB", false)
            }
            return
        }
        recoveryAttempts = UvcRecoveryRules.nextAttempt(recoveryAttempts)
        val attempt = recoveryAttempts
        val generation = ++recoveryGeneration
        Log.w(logTag, "Scheduling UVC recovery attempt $attempt/${UvcRecoveryRules.MAX_AUTOMATIC_ATTEMPTS}")
        main.postDelayed({
            if (generation != recoveryGeneration || !requested || target != null) return@postDelayed
            val attached = sameAttachedUvc(device)
            if (attached != null) {
                Log.i(logTag, "Retrying still-attached UVC device on attempt $attempt")
                selectTarget(attached)
            } else {
                recoveryAttempts = 0
                report("Camera UVC không còn gắn — đang chờ cắm lại", false)
            }
        }, UvcRecoveryRules.RETRY_DELAY_MS)
    }

    override fun onAttach(device: UsbDevice) {
        Log.i(logTag, "USB device attached: ${device.vendorId}:${device.productId}")
        if (requested && target == null && isUvcDevice(device)) {
            main.post {
                if (requested && target == null) {
                    recoveryGeneration++
                    recoveryAttempts = 0
                    selectTarget(device)
                }
            }
        }
    }
    override fun onDeviceOpen(device: UsbDevice, isFirstOpen: Boolean) {
        if (requested && device == target) {
            try {
                helper?.openCamera()
            } catch (t: Throwable) {
                Log.e(logTag, "UVC open failed", t)
                main.post {
                    if (requested && device == target) {
                        stop()
                        report("Không mở được Camera UVC", false)
                    }
                }
            }
        }
    }
    override fun onCameraOpen(device: UsbDevice) {
        main.post { if (requested && device == target) beginPreview() }
    }
    override fun onCameraClose(device: UsbDevice) {
        main.post {
            if (device == target && requested) {
                releasePreview()
                target = null
                report("Camera UVC đã đóng — đang chờ kết nối lại", false)
                scheduleRecovery(device)
            }
        }
    }
    override fun onDeviceClose(device: UsbDevice) {
        main.post {
            if (device == target && requested) {
                releasePreview()
                target = null
                report("USB camera mất kết nối — đang chờ kết nối lại", false)
                scheduleRecovery(device)
            }
        }
    }
    override fun onDetach(device: UsbDevice) {
        main.post {
            if (device == target) {
                recoveryGeneration++
                recoveryAttempts = 0
                releasePreview()
                target = null
                if (requested) {
                    report("Đã rút Camera USB — đang chờ cắm lại", false)
                }
            } else if (target == null) {
                recoveryGeneration++
                recoveryAttempts = 0
            }
        }
    }
    override fun onCancel(device: UsbDevice) {
        main.post {
            // Another USB device may cancel while the selected camera is in use.
            if (requested && device == target) {
                stop()
                report("Quyền USB bị từ chối", false)
            }
        }
    }
    override fun onError(device: UsbDevice, e: CameraException) {
        Log.e(logTag, "UVC error", e)
        main.post {
            if (device == target && requested) {
                releasePreview()
                target = null
                runCatching { helper?.closeCamera() }
                    .onFailure { Log.w(logTag, "closeCamera after UVC error", it) }
                report("Lỗi UVC: ${e.message} — đang chờ kết nối lại", false)
                scheduleRecovery(device)
            }
        }
    }

    override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        beginPreview()
    }
    override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {}
    override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        releasePreview()
        return true
    }
    override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {}

    private fun releasePreview() {
        val h = helper
        if (previewStarted) {
            try { h?.stopPreview() } catch (t: Throwable) { Log.w(logTag, "stopPreview", t) }
        }
        try { surface?.let { h?.removeSurface(it) } } catch (t: Throwable) { Log.w(logTag, "removeSurface", t) }
        try { surface?.release() } catch (_: Throwable) {}
        surface = null
        previewStarted = false
    }
    fun stop() {
        requested = false
        recoveryGeneration++
        recoveryAttempts = 0
        if (preview.surfaceTextureListener === this) preview.surfaceTextureListener = null
        releasePreview()
        try { helper?.setStateCallback(null) } catch (_: Throwable) {}
        try { helper?.closeCamera() } catch (_: Throwable) {}
        try { helper?.release() } catch (t: Throwable) { Log.w(logTag, "release", t) }
        helper = null
        target = null
    }
}
