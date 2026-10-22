package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/** Separate USB Host UVC window, not a simulation or Camera2 phone-camera fallback. */
class UsbCameraActivity : Activity() {
    companion object {
        private var visible = WeakReference<UsbCameraActivity>(null)
        fun toggleFromShortcut(context: Context, displayId: Int) {
            val existing = visible.get()
            if (existing != null && !existing.isFinishing) {
                existing.runOnUiThread { existing.toggle() }
                return
            }
            val intent = Intent(context, UsbCameraActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try {
                val opts = ActivityOptions.makeBasic()
                if (displayId >= 0) opts.launchDisplayId = displayId
                context.startActivity(intent, opts.toBundle())
            } catch (t: Throwable) {
                Log.w("UltraCarV2UVC", "Display launch failure", t)
                try { context.startActivity(intent) } catch (fail: Throwable) {
                    Log.e("UltraCarV2UVC", "Camera launch failed", fail)
                }
            }
        }
    }
    private lateinit var camera: UsbUvcController
    private lateinit var status: TextView
    private lateinit var openClose: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        val texture = TextureView(this)
        root.addView(texture, FrameLayout.LayoutParams(-1, -1))
        val guide = object : View(this) {
            private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 5f; style=Paint.Style.STROKE }
            override fun onDraw(canvas: android.graphics.Canvas) {
                super.onDraw(canvas)
                val w=width.toFloat(); val h=height.toFloat()
                for ((index, frac) in listOf(.43f,.57f,.73f).withIndex()) {
                    pen.color = intArrayOf(Color.GREEN, Color.YELLOW, Color.RED)[index]
                    canvas.drawLine(w*.32f,h*frac,w*.68f,h*frac,pen)
                }
            }
        }
        root.addView(guide, FrameLayout.LayoutParams(-1,-1))
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22,18,22,18)
            setBackgroundColor(0xBB151C24.toInt())
        }
        val label = TextView(this).apply {
            text="UltraCarHCM V2 — Camera USB"
            textSize=18f; setTextColor(Color.WHITE)
        }
        controls.addView(label)
        status = TextView(this).apply {
            text="Chưa có khung hình từ USB UVC"
            textSize=13f;setTextColor(Color.YELLOW)
            setPadding(0,6,0,8)
        }
        controls.addView(status)
        val row = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
        openClose = Button(this).apply { text="MỞ CAMERA USB"; setOnClickListener { toggle() } }
        row.addView(openClose, LinearLayout.LayoutParams(0,-2,1f))
        val back = Button(this).apply { text="ĐÓNG CỬA SỔ";setOnClickListener { finish() } }
        row.addView(back, LinearLayout.LayoutParams(0,-2,1f))
        controls.addView(row)
        controls.addView(TextView(this).apply {
            text="Vạch màu là minh họa, chưa hiệu chuẩn khoảng cách. Chưa nghiệm thu trên xe."
            textSize=11f;setTextColor(0xFFE0E0E0.toInt())
        })
        root.addView(controls,FrameLayout.LayoutParams(-1,-2,Gravity.TOP))
        camera = UsbUvcController(this,texture) { text,active ->
            runOnUiThread {
                status.text=text
                status.setTextColor(if(active) Color.GREEN else Color.YELLOW)
                openClose.text=if(camera.requested) "ĐÓNG CAMERA USB" else "MỞ CAMERA USB"
                guide.visibility=if(active) View.VISIBLE else View.GONE
            }
        }
        guide.visibility=View.GONE
        visible = WeakReference(this)
        openCamera()
    }
    private fun openCamera() {
        camera.start()
        openClose.text=if(camera.requested) "ĐÓNG CAMERA USB" else "THỬ LẠI CAMERA"
    }
    private fun toggle() {
        if (camera.requested) {
            camera.stop()
            status.text="Đã đóng Camera USB"
            openClose.text="MỞ CAMERA USB"
        } else openCamera()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if(intent.action=="ai.tigeriq.ultracarhcm.v2.TOGGLE")toggle()
    }
    override fun onDestroy() {
        camera.stop()
        if(visible.get()===this)visible=WeakReference(null)
        super.onDestroy()
    }
}
