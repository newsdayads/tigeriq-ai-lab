package ai.tigeriq.ultracarhcm.v2

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.ImageButton
import kotlin.math.abs

class OverlayService : Service(), DisplayManager.DisplayListener {
    companion object {
        const val EXTRA_FORCE_REATTACH = "ai.tigeriq.ultracarhcm.v2.extra.FORCE_OVERLAY_REATTACH"
    }
    private val handler = Handler(Looper.getMainLooper())
    private var manager: WindowManager? = null
    private var shortcut: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var currentId = -1
    private var requestedId = 0
    private val logTag = "UltraCarV2Overlay"

    override fun onCreate() {
        super.onCreate()
        (getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
            ?.registerDisplayListener(this, handler)
    }
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        requestedId = intent?.getIntExtra("displayId", requestedId) ?: requestedId
        val forceReattach = intent?.getBooleanExtra(EXTRA_FORCE_REATTACH, false) ?: false
        update(forceReattach = forceReattach)
        return START_NOT_STICKY
    }

    private fun update(forceReattach: Boolean = false) {
        if (!Settings.canDrawOverlays(this) || !DexUtils.isDesktop(this)) {
            remove()
            Log.i(logTag, "Permission or DeX unavailable")
            return
        }
        val display = DexUtils.resolveDisplay(this, requestedId) ?: run { remove(); return }
        val id = display.displayId
        if (!forceReattach && shortcut != null && currentId == id) return
        remove()
        val size = (56f * resources.displayMetrics.density).toInt()
        val pref = getSharedPreferences("v2_camera_shortcut", Context.MODE_PRIVATE)
        val p = WindowManager.LayoutParams(
            size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
        p.gravity = Gravity.TOP or Gravity.START
        val w = display.mode.physicalWidth
        val h = display.mode.physicalHeight
        val xKey = OverlayPositionRules.xKey(id)
        val yKey = OverlayPositionRules.yKey(id)
        fun storedInt(key: String): Int? =
            if (pref.contains(key)) pref.getInt(key, 0) else null
        val restored = OverlayPositionRules.clamp(
            OverlayPositionRules.restoredCoordinate(
                storedInt(xKey),
                storedInt(OverlayPositionRules.PORTABLE_X_KEY),
                storedInt("x"),
                OverlayPositionRules.DEFAULT_X,
            ),
            OverlayPositionRules.restoredCoordinate(
                storedInt(yKey),
                storedInt(OverlayPositionRules.PORTABLE_Y_KEY),
                storedInt("y"),
                OverlayPositionRules.DEFAULT_Y,
            ),
            w,
            h,
            size,
        )
        p.x = restored.x
        p.y = restored.y
        try {
            var ctx: Context = createDisplayContext(display)
            if (Build.VERSION.SDK_INT >= 30) {
                ctx = ctx.createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
            }
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val button = ImageButton(ctx)
            button.setImageResource(android.R.drawable.ic_menu_camera)
            button.setColorFilter(Color.WHITE)
            button.contentDescription = "Camera nổi UltraCarHCM V2"
            // Owner contract: one visible camera glyph on transparent background; no black square.
            button.setBackgroundColor(Color.TRANSPARENT)
            button.setOnTouchListener(object : View.OnTouchListener {
                var downX = 0f
                var downY = 0f
                var startX = 0
                var startY = 0
                var dragging = false
                val slop = ViewConfiguration.get(ctx).scaledTouchSlop
                override fun onTouch(v: View, event: MotionEvent): Boolean {
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> {
                            downX = event.rawX; downY = event.rawY
                            startX = p.x; startY = p.y; dragging = false
                            return true
                        }
                        MotionEvent.ACTION_MOVE -> {
                            val dx = event.rawX - downX
                            val dy = event.rawY - downY
                            if (abs(dx) > slop || abs(dy) > slop) dragging = true
                            if (dragging) {
                                p.x = (startX + dx.toInt()).coerceIn(0, maxOf(0, w - size))
                                p.y = (startY + dy.toInt()).coerceIn(0, maxOf(0, h - size))
                                try { wm.updateViewLayout(button, p) } catch (t: Throwable) { Log.e(logTag, "Move failed", t) }
                            }
                            return true
                        }
                        MotionEvent.ACTION_UP -> {
                            if (dragging) {
                                val persisted = pref.edit()
                                    .putInt(xKey, p.x)
                                    .putInt(yKey, p.y)
                                    .putInt(OverlayPositionRules.PORTABLE_X_KEY, p.x)
                                    .putInt(OverlayPositionRules.PORTABLE_Y_KEY, p.y)
                                    .remove("x")
                                    .remove("y")
                                    .commit()
                                if (!persisted) {
                                    Log.e(
                                        logTag,
                                        "Position persistence failed display=$id at (${p.x},${p.y})",
                                    )
                                }
                            } else {
                                UsbCameraActivity.toggleFromShortcut(this@OverlayService, currentId)
                            }
                            return true
                        }
                        MotionEvent.ACTION_CANCEL -> return true
                    }
                    return false
                }
            })
            wm.addView(button, p)
            manager = wm
            shortcut = button
            params = p
            currentId = id
            Log.i(logTag, "Attached display=$id at (${p.x},${p.y})")
        } catch (t: Throwable) {
            Log.e(logTag, "addView failed: reset and allow retry", t)
            remove()
        }
    }

    private fun remove() {
        val v = shortcut
        if (v != null) try { manager?.removeViewImmediate(v) } catch (t: Throwable) { Log.w(logTag, "removeView failed", t) }
        shortcut = null
        params = null
        manager = null
        currentId = -1
    }
    override fun onDisplayAdded(displayId: Int) = update()
    override fun onDisplayChanged(displayId: Int) =
        update(forceReattach = displayId == currentId)
    override fun onDisplayRemoved(displayId: Int) =
        update(forceReattach = displayId == currentId)
    override fun onDestroy() {
        (getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.unregisterDisplayListener(this)
        remove()
        super.onDestroy()
    }
}
