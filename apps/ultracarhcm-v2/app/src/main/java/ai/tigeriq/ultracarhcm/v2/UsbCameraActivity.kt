package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.graphics.Color
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
        const val EXTRA_REVERSE_ACTIVE = "ai.tigeriq.ultracarhcm.v2.extra.REVERSE_ACTIVE"
        const val EXTRA_STEERING_DEGREES = "ai.tigeriq.ultracarhcm.v2.extra.STEERING_DEGREES"
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
    private lateinit var guide: DynamicGuideView
    private var cameraFrameActive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        val texture = TextureView(this)
        root.addView(texture, FrameLayout.LayoutParams(-1, -1))
        guide = DynamicGuideView(this)
        root.addView(guide, FrameLayout.LayoutParams(-1,-1))
        applyReverseGuideIntent(intent)
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
            text="Guide cong chỉ hiện khi có tín hiệu lùi được truyền vào. Chưa hiệu chuẩn khoảng cách/góc lái và chưa nghiệm thu trên xe."
            textSize=11f;setTextColor(0xFFE0E0E0.toInt())
        })
        root.addView(controls,FrameLayout.LayoutParams(-1,-2,Gravity.TOP))
        camera = UsbUvcController(this,texture) { text,active ->
            runOnUiThread {
                cameraFrameActive = active
                status.text=text
                status.setTextColor(if(active) Color.GREEN else Color.YELLOW)
                openClose.text=if(camera.requested) "ĐÓNG CAMERA USB" else "MỞ CAMERA USB"
                updateGuideVisibility()
            }
        }
        updateGuideVisibility()
        visible = WeakReference(this)
        openCamera()
    }
    private fun applyReverseGuideIntent(intent: Intent) {
        guide.updateGuide(
            GuideCurveState(
                reverseActive = intent.getBooleanExtra(EXTRA_REVERSE_ACTIVE, false),
                steeringDegrees = intent.getFloatExtra(EXTRA_STEERING_DEGREES, 0f),
            ),
        )
        updateGuideVisibility()
    }

    private fun updateGuideVisibility() {
        guide.visibility =
            if (cameraFrameActive && guide.curveState.reverseActive) View.VISIBLE else View.GONE
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
        setIntent(intent)
        applyReverseGuideIntent(intent)
        if(intent.action=="ai.tigeriq.ultracarhcm.v2.TOGGLE")toggle()
    }
    override fun onDestroy() {
        camera.stop()
        if(visible.get()===this)visible=WeakReference(null)
        super.onDestroy()
    }
}
