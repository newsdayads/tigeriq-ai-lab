package ai.tigeriq.camera

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 100% Vector Canvas Engine for TigerIQ Camera Dynamic Reverse Guidelines.
 * Replaces the jagged raster clipping with smooth continuous Bézier curves.
 * Supports 3 professional OEM styles, steering gyro bending, inversion toggle,
 * and high-contrast distance badges (0.5m, 1.0m, 1.5m).
 */
class DynamicGuideView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr), SensorEventListener {

    private val settings = CameraSettings(context)
    private val mainHandler = Handler(Looper.getMainLooper())

    // Graphics Paints & Paths
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
        color = Color.WHITE
    }
    private val leftPath = Path()
    private val rightPath = Path()

    // Curvature state
    var curvature: Float = 0f
        private set
    private var targetCurvature: Float = 0f

    // Sensor State
    private var sensorManager: SensorManager? = null
    private var gyroSensor: Sensor? = null
    private var gravitySensor: Sensor? = null
    private var isSensorRegistered = false
    private var lastGyroTime: Long = 0L
    private var signedYaw: Float = 0f
    private var gyroMagnitude: Float = 0f
    private var gravityX = 0f
    private var gravityY = 9.81f
    private var gravityZ = 0f
    private var gravityReady = false

    // Touch steer calibration
    private var touchStartX = 0f
    private var isTouchSteering = false

    var isGuideVisible: Boolean
        get() = settings.isGuidelinesEnabled
        set(value) {
            settings.isGuidelinesEnabled = value
            invalidate()
        }

    fun setSteeringDegrees(degrees: Float) {
        val dirMultiplier = if (settings.isSteeringInverted) -1.0f else 1.0f
        targetCurvature = (degrees / 450f * dirMultiplier).coerceIn(-1.0f, 1.0f)
        invalidate()
    }

    private val animateRunnable = object : Runnable {
        override fun run() {
            val now = SystemClock.uptimeMillis()
            val dirMultiplier = if (settings.isSteeringInverted) -1.0f else 1.0f

            if (!isTouchSteering) {
                if (now - lastGyroTime < 1200L && gyroMagnitude > 0.005f) {
                    val yaw = signedYaw
                    if (abs(yaw) > 0.006f) {
                        val strength = max(0.12f, min(0.85f, abs(yaw) * 8.5f))
                        // Vehicle reversing & turning right rotates clockwise (yaw < 0), guidelines must curve right (positive curvature)
                        targetCurvature = dirMultiplier * (if (yaw < 0f) strength else -strength)
                    }
                } else if (abs(targetCurvature) > 0.01f) {
                    targetCurvature *= 0.88f // return to center smoothly
                }
            }

            // Smooth interpolation
            curvature = 0.65f * curvature + 0.35f * targetCurvature
            if (abs(curvature) < 0.004f) curvature = 0f

            invalidate()
            mainHandler.postDelayed(this, 33) // ~30 fps
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        registerSensors()
        mainHandler.post(animateRunnable)
    }

    override fun onDetachedFromWindow() {
        unregisterSensors()
        mainHandler.removeCallbacks(animateRunnable)
        super.onDetachedFromWindow()
    }

    private fun registerSensors() {
        if (isSensorRegistered) return
        try {
            sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            sensorManager?.let { sm ->
                gyroSensor = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
                gyroSensor?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
                gravitySensor = sm.getDefaultSensor(Sensor.TYPE_GRAVITY)
                gravitySensor?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
                isSensorRegistered = true
            }
        } catch (_: Throwable) {}
    }

    private fun unregisterSensors() {
        if (!isSensorRegistered) return
        try {
            sensorManager?.unregisterListener(this)
            isSensorRegistered = false
        } catch (_: Throwable) {}
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onSensorChanged(event: SensorEvent?) {
        val ev = event ?: return
        val v = ev.values ?: return
        if (v.size < 3) return

        when (ev.sensor.type) {
            Sensor.TYPE_GRAVITY -> {
                gravityX = v[0]
                gravityY = v[1]
                gravityZ = v[2]
                gravityReady = true
            }
            Sensor.TYPE_GYROSCOPE -> {
                val mag = max(abs(v[0]), max(abs(v[1]), abs(v[2])))
                gyroMagnitude = gyroMagnitude * 0.65f + 0.35f * mag
                val yaw = if (gravityReady) {
                    (v[0] * gravityX + v[1] * gravityY + v[2] * gravityZ) / 9.81f
                } else {
                    v[1]
                }
                signedYaw = 0.55f * signedYaw + 0.45f * yaw
                lastGyroTime = SystemClock.uptimeMillis()
            }
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Return false to allow touches to pass seamlessly to bottom toolbar and DeX window
        return false
    }

    override fun onDraw(canvas: Canvas) {
        if (!settings.isGuidelinesEnabled) return

        val w = width
        val h = height
        if (w < 50 || h < 50) return

        val style = settings.guidelineStyle
        val scale = settings.guidelineScale.coerceIn(0.8f, 1.8f)
        val warp = settings.warpFactor
        val effectiveCurve = curvature * warp

        val bottomY = h * 0.92f
        val topY = h * 0.44f

        val bottomHalfW = (w * 0.32f * scale).coerceAtMost(w * 0.44f)
        val topHalfW = (w * 0.14f * scale).coerceAtMost(w * 0.25f)

        val cx = w * 0.5f
        val maxCurveShift = w * 0.12f
        val curveShift = (effectiveCurve * w * 0.12f).coerceIn(-maxCurveShift, maxCurveShift)

        val blX = (cx - bottomHalfW).coerceIn(dp(16f), w - dp(16f))
        val brX = (cx + bottomHalfW).coerceIn(dp(16f), w - dp(16f))
        val tlX = (cx - topHalfW + curveShift).coerceIn(dp(16f), w - dp(16f))
        val trX = (cx + topHalfW + curveShift).coerceIn(dp(16f), w - dp(16f))

        val ctrlShift = curveShift * 0.55f
        val midY = (bottomY + topY) * 0.5f
        val ctrlLx = ((blX + tlX) * 0.5f + ctrlShift).coerceIn(dp(16f), w - dp(16f))
        val ctrlRx = ((brX + trX) * 0.5f + ctrlShift).coerceIn(dp(16f), w - dp(16f))

        leftPath.reset()
        leftPath.moveTo(blX, bottomY)
        leftPath.quadTo(ctrlLx, midY, tlX, topY)

        rightPath.reset()
        rightPath.moveTo(brX, bottomY)
        rightPath.quadTo(ctrlRx, midY, trX, topY)

        when (style) {
            CameraSettings.STYLE_PORSCHE_GT -> {
                drawPorscheGt(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)
            }
            CameraSettings.STYLE_AUDI_MATRIX -> {
                drawAudiMatrix(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)
            }
            CameraSettings.STYLE_TESLA_CYBER -> {
                drawTeslaCyber(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)
            }
            CameraSettings.STYLE_LUXURY_GOLD -> {
                drawLuxuryOem(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)
            }
            else -> {
                drawSportRacing(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)
            }
        }
    }

    /**
     * MẪU 1: OEM Sport Racing (Chuẩn UltraCar: 3 dải màu Đỏ/Vàng/Xanh, cánh bẻ lái & tim đứt nét)
     */
    private fun drawSportRacing(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float,
        scale: Float
    ) {
        val strokeW = dp(4.0f) * scale

        // 1. Draw segment side rails: Red (0-0.20), Yellow (0.20-0.50), Green (0.50-0.85)
        drawSegmentRail(canvas, blX, ctrlLx, tlX, bottomY, topY, 0.0f, 0.20f, Color.rgb(239, 68, 68), strokeW)
        drawSegmentRail(canvas, brX, ctrlRx, trX, bottomY, topY, 0.0f, 0.20f, Color.rgb(239, 68, 68), strokeW)

        drawSegmentRail(canvas, blX, ctrlLx, tlX, bottomY, topY, 0.20f, 0.50f, Color.rgb(234, 179, 8), strokeW)
        drawSegmentRail(canvas, brX, ctrlRx, trX, bottomY, topY, 0.20f, 0.50f, Color.rgb(234, 179, 8), strokeW)

        drawSegmentRail(canvas, blX, ctrlLx, tlX, bottomY, topY, 0.50f, 0.85f, Color.rgb(34, 197, 94), strokeW)
        drawSegmentRail(canvas, brX, ctrlRx, trX, bottomY, topY, 0.50f, 0.85f, Color.rgb(34, 197, 94), strokeW)

        // 2. Center dashed line along curvature
        drawCenterDashedLine(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)

        // 3. Distance crossbars without protruding wings
        drawDistanceBarSport(canvas, bottomY, topY, 0.20f, Color.rgb(239, 68, 68), "0.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarSport(canvas, bottomY, topY, 0.50f, Color.rgb(234, 179, 8), "1.0m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarSport(canvas, bottomY, topY, 0.85f, Color.rgb(34, 197, 94), "1.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
    }

    /**
     * MẪU 2: Porsche GT HUD (Vạch Neon Glowing đa sắc, vệt cắt laser & tâm nhắm thể thao)
     */
    private fun drawPorscheGt(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float,
        scale: Float
    ) {
        val strokeW = dp(4.2f) * scale
        glowPaint.strokeWidth = strokeW * 2.2f
        glowPaint.color = Color.argb(45, 255, 60, 0)
        canvas.drawPath(leftPath, glowPaint)
        canvas.drawPath(rightPath, glowPaint)

        drawSegmentRail(canvas, blX, ctrlLx, tlX, bottomY, topY, 0.0f, 0.22f, Color.rgb(255, 45, 85), strokeW)
        drawSegmentRail(canvas, brX, ctrlRx, trX, bottomY, topY, 0.0f, 0.22f, Color.rgb(255, 45, 85), strokeW)

        drawSegmentRail(canvas, blX, ctrlLx, tlX, bottomY, topY, 0.22f, 0.52f, Color.rgb(255, 159, 10), strokeW)
        drawSegmentRail(canvas, brX, ctrlRx, trX, bottomY, topY, 0.22f, 0.52f, Color.rgb(255, 159, 10), strokeW)

        drawSegmentRail(canvas, blX, ctrlLx, tlX, bottomY, topY, 0.52f, 0.88f, Color.rgb(48, 209, 88), strokeW)
        drawSegmentRail(canvas, brX, ctrlRx, trX, bottomY, topY, 0.52f, 0.88f, Color.rgb(48, 209, 88), strokeW)

        drawCenterDashedLine(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY, scale)

        drawDistanceBarSport(canvas, bottomY, topY, 0.22f, Color.rgb(255, 45, 85), "0.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarSport(canvas, bottomY, topY, 0.52f, Color.rgb(255, 159, 10), "1.0m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarSport(canvas, bottomY, topY, 0.88f, Color.rgb(48, 209, 88), "1.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
    }

    /**
     * MẪU 3: Audi Matrix Cyber HUD (Lưới phối cảnh 3D mặt đường Neon Cyan & Laser)
     */
    private fun drawAudiMatrix(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float,
        scale: Float
    ) {
        val strokeW = dp(3.2f) * scale
        linePaint.strokeWidth = strokeW
        linePaint.color = Color.rgb(0, 229, 255)
        canvas.drawPath(leftPath, linePaint)
        canvas.drawPath(rightPath, linePaint)

        drawPerspectiveGrid(canvas, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY)

        drawDistanceBarMinimal(canvas, bottomY, topY, 0.20f, Color.rgb(255, 59, 48), "0.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarMinimal(canvas, bottomY, topY, 0.50f, Color.rgb(255, 204, 0), "1.0m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarMinimal(canvas, bottomY, topY, 0.85f, Color.rgb(0, 229, 255), "1.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
    }

    /**
     * MẪU 4: Tesla Cyber Vision (Tia Laser trắng tinh khiết siêu nét & vạch cản tối giản)
     */
    private fun drawTeslaCyber(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float,
        scale: Float
    ) {
        val strokeW = dp(2.8f) * scale
        linePaint.strokeWidth = strokeW
        linePaint.color = Color.rgb(240, 248, 255)
        canvas.drawPath(leftPath, linePaint)
        canvas.drawPath(rightPath, linePaint)

        drawDistanceBarMinimal(canvas, bottomY, topY, 0.20f, Color.rgb(255, 69, 58), "0.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarMinimal(canvas, bottomY, topY, 0.50f, Color.rgb(255, 214, 10), "1.0m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarMinimal(canvas, bottomY, topY, 0.85f, Color.rgb(100, 210, 255), "1.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
    }

    private fun drawPerspectiveGrid(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float
    ) {
        glowPaint.color = Color.argb(60, 0, 229, 255)
        glowPaint.strokeWidth = dp(1.2f)
        for (i in 1..8) {
            val t = i * 0.11f
            val y = bottomY - t * (bottomY - topY)
            val lx = interpolateBezier(blX, ctrlLx, tlX, t)
            val rx = interpolateBezier(brX, ctrlRx, trX, t)
            canvas.drawLine(lx, y, rx, y, glowPaint)
        }
    }

    /**
     * MẪU 5: Luxury Maybach Gold (Mercedes / Maybach Style Dual Gold-Amber Lines)
     */
    private fun drawLuxuryOem(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float,
        scale: Float
    ) {
        val strokeW = dp(3.8f) * scale
        linePaint.strokeWidth = strokeW
        linePaint.color = Color.argb(230, 255, 190, 0)
        canvas.drawPath(leftPath, linePaint)
        canvas.drawPath(rightPath, linePaint)

        drawSegmentTicks(canvas, 10, blX, brX, tlX, trX, ctrlLx, ctrlRx, bottomY, topY)

        drawDistanceBarOem(canvas, bottomY, topY, 0.20f, Color.rgb(239, 68, 68), "0.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarOem(canvas, bottomY, topY, 0.50f, Color.rgb(255, 190, 0), "1.0m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
        drawDistanceBarOem(canvas, bottomY, topY, 0.85f, Color.rgb(34, 197, 94), "1.5m", blX, brX, tlX, trX, ctrlLx, ctrlRx, scale)
    }

    private fun drawSegmentRail(
        canvas: Canvas,
        p0X: Float, p1X: Float, p2X: Float,
        bottomY: Float, topY: Float,
        tStart: Float, tEnd: Float,
        color: Int, strokeWidth: Float
    ) {
        val steps = 8
        linePaint.color = color
        linePaint.strokeWidth = strokeWidth

        var prevX = interpolateBezier(p0X, p1X, p2X, tStart)
        var prevY = bottomY - tStart * (bottomY - topY)

        for (i in 1..steps) {
            val t = tStart + (tEnd - tStart) * (i.toFloat() / steps)
            val currX = interpolateBezier(p0X, p1X, p2X, t)
            val currY = bottomY - t * (bottomY - topY)
            canvas.drawLine(prevX, prevY, currX, currY, linePaint)
            prevX = currX
            prevY = currY
        }
    }

    private fun drawCenterDashedLine(
        canvas: Canvas,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float,
        bottomY: Float, topY: Float,
        scale: Float
    ) {
        linePaint.color = Color.argb(220, 255, 255, 255)
        linePaint.strokeWidth = dp(2.5f) * scale

        val dashCount = 7
        for (i in 0 until dashCount) {
            val t1 = 0.08f + i * 0.11f
            val t2 = t1 + 0.055f
            if (t2 > 0.90f) break

            val x1 = interpolateBezier((blX + brX) * 0.5f, (ctrlLx + ctrlRx) * 0.5f, (tlX + trX) * 0.5f, t1)
            val y1 = bottomY - t1 * (bottomY - topY)
            val x2 = interpolateBezier((blX + brX) * 0.5f, (ctrlLx + ctrlRx) * 0.5f, (tlX + trX) * 0.5f, t2)
            val y2 = bottomY - t2 * (bottomY - topY)

            canvas.drawLine(x1, y1, x2, y2, linePaint)
        }
    }

    private fun drawDistanceBarSport(
        canvas: Canvas, bottomY: Float, topY: Float, t: Float,
        color: Int, label: String,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float,
        scale: Float
    ) {
        val y = bottomY - t * (bottomY - topY)
        val lx = interpolateBezier(blX, ctrlLx, tlX, t)
        val rx = interpolateBezier(brX, ctrlRx, trX, t)

        linePaint.color = color
        linePaint.strokeWidth = dp(3.8f) * scale
        canvas.drawLine(lx, y, rx, y, linePaint)

        drawBadge(canvas, (lx + rx) * 0.5f, y, label, color, scale)
    }

    private fun drawDistanceBarOem(
        canvas: Canvas, bottomY: Float, topY: Float, t: Float,
        color: Int, label: String,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float,
        scale: Float
    ) {
        val y = bottomY - t * (bottomY - topY)
        val lx = interpolateBezier(blX, ctrlLx, tlX, t)
        val rx = interpolateBezier(brX, ctrlRx, trX, t)

        linePaint.color = color
        linePaint.strokeWidth = dp(3.2f) * scale
        canvas.drawLine(lx, y, rx, y, linePaint)

        drawBadge(canvas, (lx + rx) * 0.5f, y, label, color, scale)
    }

    private fun drawDistanceBarMinimal(
        canvas: Canvas, bottomY: Float, topY: Float, t: Float,
        color: Int, label: String,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float,
        scale: Float
    ) {
        val y = bottomY - t * (bottomY - topY)
        val lx = interpolateBezier(blX, ctrlLx, tlX, t)
        val rx = interpolateBezier(brX, ctrlRx, trX, t)

        linePaint.color = color
        linePaint.strokeWidth = dp(2.2f) * scale
        canvas.drawLine(lx, y, rx, y, linePaint)

        drawBadge(canvas, (lx + rx) * 0.5f, y, label, color, scale)
    }

    private fun drawSegmentTicks(
        canvas: Canvas, count: Int,
        blX: Float, brX: Float, tlX: Float, trX: Float,
        ctrlLx: Float, ctrlRx: Float, bottomY: Float, topY: Float
    ) {
        linePaint.color = Color.argb(180, 255, 255, 255)
        linePaint.strokeWidth = dp(2.0f)
        val tickSize = dp(6.0f)

        for (i in 1 until count) {
            val t = i.toFloat() / count
            val y = bottomY - t * (bottomY - topY)
            val lx = interpolateBezier(blX, ctrlLx, tlX, t)
            val rx = interpolateBezier(brX, ctrlRx, trX, t)

            canvas.drawLine(lx - tickSize, y, lx + tickSize, y, linePaint)
            canvas.drawLine(rx - tickSize, y, rx + tickSize, y, linePaint)
        }
    }

    private fun drawBadge(canvas: Canvas, cx: Float, cy: Float, text: String, bgColor: Int, scale: Float = 1.0f) {
        textPaint.textSize = dp(11.5f) * scale
        val textW = textPaint.measureText(text)
        val padX = dp(8f) * scale
        val padY = dp(4f) * scale

        val badgeRect = RectF(
            cx - textW * 0.5f - padX,
            cy - dp(7.5f) * scale - padY,
            cx + textW * 0.5f + padX,
            cy + dp(7.5f) * scale + padY
        )

        // Draw dark border
        badgePaint.style = Paint.Style.STROKE
        badgePaint.strokeWidth = dp(2f) * scale
        badgePaint.color = Color.argb(200, 0, 0, 0)
        canvas.drawRoundRect(badgeRect, dp(4f) * scale, dp(4f) * scale, badgePaint)

        // Draw fill badge
        badgePaint.style = Paint.Style.FILL
        badgePaint.color = bgColor
        canvas.drawRoundRect(badgeRect, dp(4f) * scale, dp(4f) * scale, badgePaint)

        val fm = textPaint.fontMetrics
        val textY = cy - (fm.ascent + fm.descent) * 0.5f
        canvas.drawText(text, cx, textY, textPaint)
    }

    private fun interpolateBezier(p0: Float, p1: Float, p2: Float, t: Float): Float {
        val oneMinusT = 1.0f - t
        return oneMinusT * oneMinusT * p0 + 2.0f * oneMinusT * t * p1 + t * t * p2
    }

    private fun dp(valPx: Float): Float = valPx * resources.displayMetrics.density
}
