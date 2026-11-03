package ai.tigeriq.camera

import android.app.Service
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.view.Display
import android.view.Gravity
import android.view.TextureView
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.hardware.usb.UsbDevice
import android.hardware.display.DisplayManager

/**
 * Actual TYPE_APPLICATION_OVERLAY window on Samsung DeX.
 * Unlike background startActivity(), WindowManager.addView() either succeeds or errors.
 * It displays UVC preview; does not independently know the physical gear.
 */
class ReverseCameraOverlay(
    private val owner: Service,
    private val onVideoMetrics: ((UvcFrameSignalEvidence.Metrics) -> Unit)? = null
) {
    private var wm: WindowManager? = null
    private var content: FrameLayout? = null
    private var camera: UsbUvcManager? = null
    val isVisible: Boolean get() = content != null

    fun show(display: Display?): Boolean {
        if (content != null) return true
        if (!Settings.canDrawOverlays(owner)) {
            CameraEventLog.record(owner, "WINDOW", "OVERLAY_PERMISSION_MISSING")
            return false
        }
        var stage = "resolve_display"
        try {
            // Service itself has no display association; its WindowManager may throw
            // UnsupportedOperationException on DeX/Android 12+.
            val displayManager = owner.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            val targetDisplay = display?.takeIf { it.isValid }
                ?: displayManager.getDisplay(Display.DEFAULT_DISPLAY)
                ?: run {
                    CameraEventLog.record(owner, "WINDOW", "NO_VALID_DISPLAY")
                    return false
                }
            stage = "create_display_context"
            val displayContext = owner.createDisplayContext(targetDisplay)
            stage = "create_window_context"
            val ctx: Context =
                if (Build.VERSION.SDK_INT >= 30) {
                    try {
                        displayContext.createWindowContext(
                            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
                    } catch (error: Throwable) {
                        CameraEventLog.record(owner, "WINDOW", "WINDOW_CONTEXT_FALLBACK",
                            error.javaClass.simpleName + " " + (error.message ?: "").take(130))
                        displayContext
                    }
                } else displayContext
            stage = "get_window_manager"
            val manager = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val dm = ctx.resources.displayMetrics
            val scale = dm.density
            val width = (dm.widthPixels * .70f).toInt().coerceIn((320*scale).toInt(), (990*scale).toInt())
            val height = (dm.heightPixels * .68f).toInt().coerceIn((260*scale).toInt(), (590*scale).toInt())
            val root = FrameLayout(ctx)
            val border = GradientDrawable().apply {
                setColor(Color.rgb(13, 21, 35))
                cornerRadius = 14f * scale
                setStroke((2*scale).toInt().coerceAtLeast(1),Color.rgb(0,210,230))
            }
            root.background=border
            val column=LinearLayout(ctx).apply {
                orientation=LinearLayout.VERTICAL
                setPadding((8*scale).toInt(),(6*scale).toInt(),(8*scale).toInt(),(8*scale).toInt())
            }
            val titleBar=LinearLayout(ctx).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL}
            val title=TextView(ctx).apply{ text="TigerIQ Camera - USB";textSize=15f;setTextColor(Color.WHITE) }
            val close=Button(ctx).apply{text="ĐÓNG";textSize=13f;setOnClickListener{hide()}}
            titleBar.addView(title,LinearLayout.LayoutParams(0,(45*scale).toInt(),1f))
            titleBar.addView(close,LinearLayout.LayoutParams((90*scale).toInt(),(46*scale).toInt()))
            // AOSP TextureView#setBackgroundDrawable throws UOE.
            // Paint parent background, NEVER TextureView background.
            val texture=TextureView(ctx)
            val status=TextView(ctx).apply {
                text="Đang kết nối Camera UVC..."
                textSize=12f
                setTextColor(Color.LTGRAY)
            }
            column.addView(titleBar)
            val previewLayer=FrameLayout(ctx).apply { setBackgroundColor(Color.BLACK) }
            previewLayer.addView(texture,FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT))
            previewLayer.addView(DynamicGuideView(ctx),FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT))
            column.addView(previewLayer,LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,0,1f))
            column.addView(status,LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,(30*scale).toInt()))
            root.addView(column,FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT))
            val params=WindowManager.LayoutParams(width,height,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT).apply {gravity=Gravity.CENTER}
            stage = "add_view"
            manager.addView(root,params)
            this.wm=manager
            this.content=root
            CameraEventLog.record(owner,"WINDOW","OVERLAY_VISIBLE",
                "display="+(display?.displayId ?: 0)+" size="+width+"x"+height)
            try {
                val helper=UsbUvcManager(owner,texture,
                    onStatus={message,_ -> status.post { status.text=message }},
                    onPermissionRequired={_:UsbDevice,_:Boolean -> },
                    onVideoMetrics=onVideoMetrics)
                camera=helper
                helper.start()
            } catch(t:Throwable) {
                CameraEventLog.record(owner,"WINDOW","OVERLAY_CAMERA_FAILED",t.javaClass.simpleName)
                status.text="Lỗi Camera USB: "+t.javaClass.simpleName
            }
            return true
        } catch(t:Throwable) {
            CameraEventLog.record(owner,"WINDOW","OVERLAY_OPEN_FAILED",
                "stage=" + stage + " type=" + t.javaClass.simpleName +
                    " message=" + (t.message ?: "").take(180))
            hide()
            return false
        }
    }

    fun hide() {
        try{camera?.release()}catch(_ : Throwable){}
        camera=null
        val view=content
        content=null
        if(view!=null){
            try {wm?.removeViewImmediate(view)}catch(_:Throwable){}
            CameraEventLog.record(owner,"WINDOW","OVERLAY_CLOSED")
        }
        wm=null
    }
}
