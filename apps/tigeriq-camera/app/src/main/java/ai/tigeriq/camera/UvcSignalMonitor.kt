package ai.tigeriq.camera

import android.app.Service
import android.content.Context
import android.graphics.PixelFormat
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.ImageReader
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.herohan.uvcapp.CameraHelper
import com.herohan.uvcapp.CameraException
import com.herohan.uvcapp.ICameraHelper
import com.serenegiant.usb.IFrameCallback
import com.serenegiant.usb.UVCCamera
import com.serenegiant.utils.UVCUtils

/**
 * Non-visible UVC signal observer owned by FloatingCameraService.
 * Never adds UI, changes settings or requests USB permission in background.
 * Releases the camera before the approved Camera overlay claims the USB UVC.
 */
class UvcSignalMonitor(
    private val owner: Service,
    private val onMetrics: (UvcFrameSignalEvidence.Metrics) -> Unit
) : ICameraHelper.StateCallback {
    private val main = Handler(Looper.getMainLooper())
    private var helper: CameraHelper? = null
    private var reader: ImageReader? = null
    private var selected: UsbDevice? = null
    private var running = false
    private var opened = false
    private var generation = 0
    private var lastSampleAt = 0L
    private var lastFrameAt = 0L
    private var sampleCount = 0
    private var lastMetricsLogAt = 0L


    val isRunning get() = running

    fun start() {
        if (running) return
        val manager = owner.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return
        val preferred = CameraSettings(owner).workingCameraKey()
        val device = manager.deviceList.values.firstOrNull {
            (it.vendorId.toString() + ":" + it.productId) == preferred
        } ?: manager.deviceList.values.firstOrNull { UsbUvcManager.isUvc(it) }
        if (device == null) return
        if (!manager.hasPermission(device)) {
            CameraEventLog.record(owner, "VIDEO_PROBE", "USB_PERMISSION_REQUIRED",
                device.vendorId.toString() + ":" + device.productId)
            return
        }
        running = true
        selected = device
        generation++
        val epoch = generation
        try {
            UVCUtils.init(owner.applicationContext as android.app.Application)
            val instance=CameraHelper()
            helper=instance
            instance.setStateCallback(this)
            instance.selectDevice(device)
            CameraEventLog.record(owner, "VIDEO_PROBE", "START",
                "vid=" + device.vendorId + " pid=" + device.productId + " no_visible_window")
            main.postDelayed({
                if (running && epoch == generation &&
                    (lastFrameAt == 0L ||
                     SystemClock.elapsedRealtime() - lastFrameAt > 4000L)) {
                    CameraEventLog.record(owner, "VIDEO_PROBE", "NO_FRAMES",
                        "preview_open=" + opened + " cannot_determine_R")
                }
            }, 6000L)
        } catch(t: Throwable) {
            CameraEventLog.record(owner,"VIDEO_PROBE","START_ERROR",
                t.javaClass.simpleName + " " + (t.message ?: "").take(110))
            stop()
        }
    }

    fun stop() {
        generation++
        running = false
        opened = false
        selected = null
        lastFrameAt = 0L
        lastSampleAt = 0L
        sampleCount = 0
        lastMetricsLogAt = 0L
        val previous = helper
        helper = null
        try { previous?.setFrameCallback(null,UVCCamera.PIXEL_FORMAT_NV21) } catch(_: Throwable){}
        try { previous?.stopPreview() } catch(_: Throwable){}
        try { reader?.let { previous?.removeSurface(it.surface) } } catch(_: Throwable){}
        try { previous?.closeCamera() } catch(_: Throwable){}
        try { previous?.release() } catch(_: Throwable){}
        try { reader?.close() } catch(_: Throwable){}
        reader = null
    }

    override fun onAttach(device: UsbDevice) {}
    override fun onDeviceOpen(device: UsbDevice, isFirstOpen: Boolean) {
        if (!running || device != selected) return
        try { helper?.openCamera() } catch(t:Throwable) {
            CameraEventLog.record(owner, "VIDEO_PROBE", "CAMERA_OPEN_FAILED", t.javaClass.simpleName)
        }
    }
    override fun onCameraOpen(device: UsbDevice) {
        if (!running || device != selected) return
        main.post {
            if (!running || device != selected) return@post
            try {
                val instance = helper ?: return@post
                val preview = instance.previewSize
                val w = preview?.width ?: 0
                val h = preview?.height ?: 0
                if(w<=0 || h<=0) {
                    CameraEventLog.record(owner,"VIDEO_PROBE","UNKNOWN_FORMAT")
                    return@post
                }
                // Drain the tiny offscreen render target so EGL never blocks on
                // buffers. FrameCallback separately reads full-resolution NV21.
                try {
                    val drain=ImageReader.newInstance(32,32,PixelFormat.RGBA_8888,2)
                    drain.setOnImageAvailableListener({ source ->
                        try { source.acquireLatestImage()?.close() } catch(_:Throwable){}
                    },main)
                    reader=drain
                    instance.addSurface(drain.surface,false)
                } catch(t:Throwable) {
                    CameraEventLog.record(owner,"VIDEO_PROBE","OFFSCREEN_SURFACE_UNAVAILABLE",
                        t.javaClass.simpleName)
                }
                val epoch=generation
                instance.setFrameCallback(IFrameCallback { frame ->
                    if (!running || epoch != generation) return@IFrameCallback
                    val time=SystemClock.elapsedRealtime()
                    lastFrameAt=time
                    if (time-lastSampleAt>=300L) {
                        lastSampleAt=time
                        val m=UvcFrameSignalEvidence.sampleNv21(frame,w,h)
                        if(m!=null) main.post {
                            if(running && epoch==generation) {
                                sampleCount++
                                if (sampleCount == 1)
                                    CameraEventLog.record(owner,"VIDEO_PROBE","FIRST_NV21_FRAME",
                                        "width="+w+" height="+h)
                                if(sampleCount==1 || time-lastMetricsLogAt>=5000L) {
                                    lastMetricsLogAt=time
                                    CameraEventLog.record(owner,"VIDEO_PROBE","FRAME_METRICS",
                                        "mean="+String.format(java.util.Locale.US,"%.1f",m.meanLuma)+
                                        " variance="+String.format(java.util.Locale.US,"%.1f",m.lumaVariance)+
                                        " bins="+m.occupiedLumaBins+
                                        " state="+if(m.lowInformation)"LOW_INFO" else "HAS_DETAIL")
                                }
                                onMetrics(m)
                            }
                        }
                    }
                },UVCCamera.PIXEL_FORMAT_NV21)
                instance.startPreview()
                opened=true
                CameraEventLog.record(owner,"VIDEO_PROBE","PREVIEW_REQUESTED",
                    "width="+w+" height="+h+" no_window")
            } catch(t:Throwable) {
                CameraEventLog.record(owner,"VIDEO_PROBE","PREVIEW_FAILED",
                    t.javaClass.simpleName+" "+(t.message?:"").take(110))
                stop()
            }
        }
    }
    override fun onCameraClose(device: UsbDevice) {
        if(running && device==selected)
            main.post { if(running && device==selected)stop() }
    }
    override fun onDeviceClose(device: UsbDevice) {
        if(running && device==selected)main.post { stop() }
    }
    override fun onDetach(device: UsbDevice) {
        if(running && device==selected)main.post { stop() }
    }
    override fun onCancel(device: UsbDevice) {
        CameraEventLog.record(owner,"VIDEO_PROBE","PERMISSION_CANCELLED")
        main.post { stop() }
    }
    override fun onError(device: UsbDevice, error: CameraException) {
        CameraEventLog.record(owner,"VIDEO_PROBE","UVC_ERROR",
            (error.message?:"unknown").take(150))
    }
}
