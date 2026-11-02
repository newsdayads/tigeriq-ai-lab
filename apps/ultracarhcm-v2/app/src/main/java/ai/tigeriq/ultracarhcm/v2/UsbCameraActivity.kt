package ai.tigeriq.ultracarhcm.v2

import android.Manifest
import android.app.Activity
import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/** Separate USB Host UVC window, not a simulation or Camera2 phone-camera fallback. */
class UsbCameraActivity : Activity() {
    companion object {
        const val EXTRA_REVERSE_ACTIVE = "ai.tigeriq.ultracarhcm.v2.extra.REVERSE_ACTIVE"
        const val EXTRA_STEERING_DEGREES = "ai.tigeriq.ultracarhcm.v2.extra.STEERING_DEGREES"
        private const val CAMERA_PERMISSION_REQUEST = 4403
        private var visible = WeakReference<UsbCameraActivity>(null)

        fun toggleFromShortcut(context: Context, displayId: Int) {
            val existing = visible.get()?.takeUnless { it.isFinishing }
            val existingDisplayId = existing?.window?.decorView?.display?.displayId

            if (CameraDisplayRules.shouldToggleExisting(existingDisplayId, displayId)) {
                existing?.runOnUiThread { existing.toggle() }
                return
            }

            val intent = Intent(context, UsbCameraActivity::class.java)
                .addFlags(
                    if (CameraDisplayRules.needsDedicatedTask(existingDisplayId, displayId)) {
                        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK
                    } else {
                        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    },
                )
            try {
                val opts = ActivityOptions.makeBasic()
                if (displayId >= 0) opts.launchDisplayId = displayId
                context.startActivity(intent, opts.toBundle())
                if (existing != null && existingDisplayId != displayId) {
                    existing.runOnUiThread { existing.finish() }
                }
            } catch (t: Throwable) {
                Log.w("UltraCarV2UVC", "Display launch failure", t)
                if (!CameraDisplayRules.allowUnspecifiedFallback(displayId)) {
                    Log.w("UltraCarV2UVC", "Refusing unspecified fallback for explicit display=$displayId")
                    return
                }
                try {
                    context.startActivity(intent)
                } catch (fail: Throwable) {
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
    private var awaitingCameraPermission = false
    private var resumeCameraOnStart = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)

        val texture = TextureView(this)
        root.addView(texture, FrameLayout.LayoutParams(-1, -1))

        guide = DynamicGuideView(this).apply {
            contentDescription =
                "Vạch lùi trực quan; Chưa hiệu chuẩn khoảng cách/góc lái và chưa nghiệm thu trên xe"
        }
        root.addView(guide, FrameLayout.LayoutParams(-1, -1))
        applyReverseGuideIntent(intent)

        status = TextView(this).apply {
            text = "Chưa có khung hình từ USB UVC"
            textSize = 12f
            setTextColor(Color.WHITE)
            setPadding(dp(10), dp(6), dp(10), dp(6))
            setBackgroundColor(0x99000000.toInt())
        }
        root.addView(
            status,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.START,
            ).apply {
                leftMargin = dp(10)
                bottomMargin = dp(10)
            },
        )

        openClose = Button(this).apply {
            text = "CAM"
            textSize = 12f
            setTextColor(Color.WHITE)
            backgroundTintList = ColorStateList.valueOf(0xFFD84636.toInt())
            setPadding(0, 0, 0, 0)
            setOnClickListener { toggle() }
        }
        root.addView(
            openClose,
            FrameLayout.LayoutParams(dp(64), dp(52), Gravity.BOTTOM or Gravity.END).apply {
                rightMargin = dp(10)
                bottomMargin = dp(10)
            },
        )

        val close = Button(this).apply {
            text = "×"
            textSize = 22f
            setTextColor(Color.WHITE)
            contentDescription = "ĐÓNG CỬA SỔ"
            backgroundTintList = ColorStateList.valueOf(0x88000000.toInt())
            setPadding(0, 0, 0, 0)
            setOnClickListener { finish() }
        }
        root.addView(
            close,
            FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP or Gravity.END).apply {
                rightMargin = dp(8)
                topMargin = dp(8)
            },
        )

        camera = UsbUvcController(this, texture) { text, active ->
            runOnUiThread {
                cameraFrameActive = active
                status.text = text
                status.setTextColor(if (active) Color.GREEN else Color.WHITE)
                status.visibility = if (active) View.GONE else View.VISIBLE
                updateCameraButton()
                updateGuideVisibility()
            }
        }
        updateGuideVisibility()
        visible = WeakReference(this)
        openCamera()
    }

    private fun applyReverseGuideIntent(intent: Intent) {
        val current = guide.curveState
        val reverseActive =
            if (intent.hasExtra(EXTRA_REVERSE_ACTIVE))
                intent.getBooleanExtra(EXTRA_REVERSE_ACTIVE, current.reverseActive)
            else current.reverseActive
        val steeringDegrees =
            if (intent.hasExtra(EXTRA_STEERING_DEGREES))
                intent.getFloatExtra(EXTRA_STEERING_DEGREES, current.steeringDegrees)
            else current.steeringDegrees

        guide.updateGuide(
            GuideCurveState(
                reverseActive = reverseActive,
                steeringDegrees = steeringDegrees,
                warp = current.warp,
            ),
        )
        updateGuideVisibility()
    }

    private fun updateGuideVisibility() {
        guide.visibility =
            if (cameraFrameActive && guide.curveState.reverseActive) View.VISIBLE else View.GONE
    }

    private fun updateCameraButton() {
        openClose.text = "CAM"
        openClose.contentDescription =
            when {
                camera.requested -> "ĐÓNG CAMERA USB"
                awaitingCameraPermission -> "ĐANG CHỜ QUYỀN CAMERA"
                else -> "MỞ CAMERA USB"
            }
    }

    private fun openCamera() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            awaitingCameraPermission = false
            camera.start()
            updateCameraButton()
            return
        }
        if (awaitingCameraPermission) return

        awaitingCameraPermission = true
        status.text = "Cần quyền CAMERA để mở Camera USB UVC"
        status.setTextColor(Color.WHITE)
        status.visibility = View.VISIBLE
        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
        updateCameraButton()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_PERMISSION_REQUEST) return

        awaitingCameraPermission = false
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            openCamera()
        } else {
            status.text = "Quyền CAMERA bị từ chối — Camera USB chưa mở"
            status.setTextColor(Color.WHITE)
            status.visibility = View.VISIBLE
            updateCameraButton()
        }
    }

    private fun toggle() {
        if (camera.requested) {
            camera.stop()
            status.text = "Đã đóng Camera USB"
            status.visibility = View.VISIBLE
        } else {
            openCamera()
        }
        updateCameraButton()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyReverseGuideIntent(intent)
        if (intent.action == "ai.tigeriq.ultracarhcm.v2.TOGGLE") toggle()
    }

    override fun onStart() {
        super.onStart()
        if (resumeCameraOnStart) {
            resumeCameraOnStart = false
            openCamera()
        }
    }

    override fun onStop() {
        resumeCameraOnStart = camera.requested
        if (camera.requested) camera.stop()
        cameraFrameActive = false
        updateGuideVisibility()
        super.onStop()
    }

    override fun onDestroy() {
        camera.stop()
        if (visible.get() === this) visible = WeakReference(null)
        super.onDestroy()
    }
}
