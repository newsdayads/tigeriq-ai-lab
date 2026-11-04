package ai.tigeriq.camera

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.TextureView
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.min

/**
 * Singleton controller managing the dedicated WindowManager Overlay Camera window.
 * Guarantees a single, consistent, non-skewed 16:9 camera layout on Samsung DeX
 * that turns ON/OFF instantly without Android background activity restrictions.
 */
object CameraOverlayController {
    private const val TAG = "CameraOverlayCtrl"

    private var overlayView: View? = null
    private var windowManager: WindowManager? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var uvcManager: UsbUvcManager? = null
    private var parkAssistEngine: ParkAssistAudioEngine? = null
    private var guideView: DynamicGuideView? = null
    private var currentDisplayId: Int = -1

    private var isOverlayVisible: Boolean = false

    fun isShowing(): Boolean = isOverlayVisible && overlayView != null && overlayView?.visibility == View.VISIBLE

    @Synchronized
    fun show(context: Context, display: Display?, isReverse: Boolean = false, steering: Float = 0f) {
        val targetDisplay = display ?: DeXDisplayHelper.resolveTargetDisplay(context) ?: return
        val displayId = targetDisplay.displayId

        if (!Settings.canDrawOverlays(context)) {
            Log.w(TAG, "Cannot show overlay: Settings.canDrawOverlays is false")
            return
        }

        val handler = Handler(Looper.getMainLooper())
        handler.post {
            try {
                if (overlayView == null || currentDisplayId != displayId) {
                    initOverlay(context, targetDisplay)
                }

                val view = overlayView ?: return@post
                val tvGearBadge = view.findViewById<TextView>(R.id.tvGearBadge)
                val settings = CameraSettings(context)

                if (isReverse) {
                    tvGearBadge?.text = "R"
                    tvGearBadge?.setBackgroundColor(0xFFFF3B30.toInt())
                    guideView?.setSteeringDegrees(steering)
                    if (settings.isParkAssistBeepEnabled) {
                        parkAssistEngine?.start()
                    }
                } else {
                    tvGearBadge?.text = "CAM"
                    tvGearBadge?.setBackgroundColor(0xFF00D2FF.toInt())
                    guideView?.setSteeringDegrees(0f)
                    parkAssistEngine?.stop()
                }

                view.visibility = View.VISIBLE
                isOverlayVisible = true
                uvcManager?.start()
                Log.i(TAG, "Camera Overlay shown (isReverse=$isReverse, display=$displayId)")
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to show camera overlay", t)
            }
        }
    }

    @Synchronized
    fun hide() {
        val handler = Handler(Looper.getMainLooper())
        handler.post {
            try {
                parkAssistEngine?.stop()
                uvcManager?.stop()
                overlayView?.visibility = View.GONE
                isOverlayVisible = false
                Log.i(TAG, "Camera Overlay hidden")
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to hide camera overlay", t)
            }
        }
    }

    fun toggle(context: Context, display: Display?) {
        if (isShowing()) {
            hide()
        } else {
            show(context, display, isReverse = false)
        }
    }

    fun updateSteering(degrees: Float) {
        guideView?.setSteeringDegrees(degrees)
    }

    private fun initOverlay(context: Context, targetDisplay: Display) {
        destroyOverlay()
        currentDisplayId = targetDisplay.displayId

        val displayContext = context.createDisplayContext(targetDisplay)
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

        val density = ctx.resources.displayMetrics.density
        val screenW = ctx.resources.displayMetrics.widthPixels
        val screenH = ctx.resources.displayMetrics.heightPixels

        val targetW = min((screenW * 0.72f).toInt(), (860f * density).toInt())
        val targetH = min((screenH * 0.86f).toInt(), (520f * density).toInt())

        val params = WindowManager.LayoutParams(
            targetW, targetH,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            x = (28f * density).toInt()
            y = 0
        }
        layoutParams = params

        val inflater = LayoutInflater.from(ctx)
        val root = inflater.inflate(R.layout.view_camera_overlay, null)

        val textureView = root.findViewById<TextureView>(R.id.cameraTextureView)
        val gView = root.findViewById<DynamicGuideView>(R.id.dynamicGuideView)
        guideView = gView

        val cardPermissionPrompt = root.findViewById<LinearLayout>(R.id.cardPermissionPrompt)
        val btnGrantUsb = root.findViewById<Button>(R.id.btnGrantUsb)
        val tvStatusMessage = root.findViewById<TextView>(R.id.tvStatusMessage)

        val btnCloseTop = root.findViewById<ImageButton>(R.id.btnCloseTop)
        val btnCloseBottom = root.findViewById<ImageButton>(R.id.btnCloseBottom)
        val btnToggleGuide = root.findViewById<ImageButton>(R.id.btnToggleGuide)
        val btnNightBooster = root.findViewById<ImageButton>(R.id.btnNightBooster)
        val btnToggleSound = root.findViewById<ImageButton>(R.id.btnToggleSound)
        val btnSettings = root.findViewById<ImageButton>(R.id.btnSettings)
        val overlayHeader = root.findViewById<LinearLayout>(R.id.overlayHeader)

        val settings = CameraSettings(ctx)

        // Setup park assist audio
        parkAssistEngine = ParkAssistAudioEngine(ctx)

        // Setup UVC manager
        val uvc = UsbUvcManager(
            context = ctx,
            textureView = textureView,
            onStatus = { msg, _ ->
                tvStatusMessage?.text = msg
            },
            onPermissionRequired = { _, hasPerm ->
                cardPermissionPrompt?.visibility = if (hasPerm) View.GONE else View.VISIBLE
            },
            onDeviceDisconnected = {
                if (settings.isReverseImmediateClose) {
                    hide()
                }
            }
        )
        uvcManager = uvc

        btnGrantUsb?.setOnClickListener {
            uvc.requestUsbPermissionDirectly()
        }

        // Close buttons
        val closeListener = View.OnClickListener { hide() }
        btnCloseTop?.setOnClickListener(closeListener)
        btnCloseBottom?.setOnClickListener(closeListener)

        // Cycle Guidelines style
        btnToggleGuide?.setOnClickListener {
            val nextStyle = (settings.guidelineStyle + 1) % CameraSettings.TOTAL_STYLES
            settings.guidelineStyle = nextStyle
            gView?.invalidate()
            val styleName = when (nextStyle) {
                CameraSettings.STYLE_SPORT_OEM -> "Sport OEM"
                CameraSettings.STYLE_PORSCHE_GT -> "Porsche GT"
                CameraSettings.STYLE_AUDI_MATRIX -> "Audi Matrix"
                CameraSettings.STYLE_TESLA_CYBER -> "Tesla Cyber"
                CameraSettings.STYLE_LUXURY_GOLD -> "Luxury Maybach Gold"
                else -> "Mẫu $nextStyle"
            }
            tvStatusMessage?.text = "Mẫu vạch: $styleName"
        }

        // Night booster
        btnNightBooster?.setOnClickListener {
            val next = !settings.isNightBoosterEnabled
            settings.isNightBoosterEnabled = next
            applyNightBooster(textureView, next)
            btnNightBooster.setColorFilter(if (next) 0xFF00E5FF.toInt() else Color.WHITE)
            tvStatusMessage?.text = if (next) "Night Booster: BẬT" else "Night Booster: TẮT"
        }

        // Park assist sound
        btnToggleSound?.setOnClickListener {
            val next = !settings.isParkAssistBeepEnabled
            settings.isParkAssistBeepEnabled = next
            btnToggleSound.setColorFilter(if (next) 0xFF00E5FF.toInt() else Color.DKGRAY)
            tvStatusMessage?.text = if (next) "Cảnh báo Sonar: BẬT" else "Cảnh báo Sonar: TẮT"
        }

        // Settings launcher
        btnSettings?.setOnClickListener {
            val intent = Intent(ctx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            try {
                ctx.startActivity(intent)
            } catch (_: Throwable) {}
        }

        // Make window draggable via overlayHeader
        attachDragListener(overlayHeader, params, wm, root)

        // Initial setup
        applyNightBooster(textureView, settings.isNightBoosterEnabled)
        btnNightBooster?.setColorFilter(if (settings.isNightBoosterEnabled) 0xFF00E5FF.toInt() else Color.WHITE)
        btnToggleSound?.setColorFilter(if (settings.isParkAssistBeepEnabled) 0xFF00E5FF.toInt() else Color.DKGRAY)
        gView?.invalidate()

        root.visibility = View.GONE
        wm.addView(root, params)
        overlayView = root
    }

    private fun attachDragListener(header: View?, params: WindowManager.LayoutParams, wm: WindowManager, root: View) {
        if (header == null) return
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var isDragging = false

        header.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = params.x
                    startY = params.y
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (downX - event.rawX).toInt()
                    val dy = (event.rawY - downY).toInt()
                    if (Math.hypot(dx.toDouble(), dy.toDouble()) > 10) {
                        isDragging = true
                        params.x = startX + dx
                        params.y = startY + dy
                        try {
                            wm.updateViewLayout(root, params)
                        } catch (_: Throwable) {}
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun applyNightBooster(textureView: TextureView?, enabled: Boolean) {
        if (textureView == null) return
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
            textureView.setLayerType(View.LAYER_TYPE_HARDWARE, Paint().apply {
                colorFilter = ColorMatrixColorFilter(cm)
            })
        } else {
            textureView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }
    }

    @Synchronized
    fun destroyOverlay() {
        uvcManager?.release()
        uvcManager = null
        parkAssistEngine?.release()
        parkAssistEngine = null
        overlayView?.let {
            try {
                windowManager?.removeView(it)
            } catch (_: Throwable) {}
        }
        overlayView = null
        windowManager = null
        isOverlayVisible = false
        currentDisplayId = -1
    }
}
