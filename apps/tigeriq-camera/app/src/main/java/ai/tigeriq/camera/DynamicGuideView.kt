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

/**
 * 100% Vector Canvas Engine for TigerIQ Camera Dynamic Reverse Guidelines.
 * Supports OEM styles + dual tire-track ribbons, concentric ReversePathGeometry arcs,
 * verified steering angle priority, and vibration-gated Gyro + UVC optical motion curving.
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
    private val wheelRibbonPath = Path()
    private val crossbarPath = Path()
    private val wheelFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(145, 10, 132, 255)
    }
    private val wheelEdgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = Color.argb(190, 96, 175, 255)
    }
    private val outerRailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = Color.argb(242, 26, 148, 255)
    }

    // Curvature state
    var curvature: Float = 0f
        private set
    private var currentWheelDegrees: Float = 0f

    private val motionEstimator = MotionSteeringEstimator()
    private val steeringResolver = GuideSteeringResolver()

    // Orientation-invariant Gyro + Gravity sensor state
    private var sensorManager: SensorManager? = null
    private var isSensorRegistered = false
    private var gravityX = 0f
    private var gravityY = 9.81f
    private var gravityZ = 0f
    private var gravityReady = false

    var isGuideVisible: Boolean
        get() = settings.isGuidelinesEnabled
        set(value) {
            settings.isGuidelinesEnabled = value
            invalidate()
        }

    fun onVideoMotionScore(score: Float) {
        motionEstimator.onVideoMotionScore(score, SystemClock.uptimeMillis())
    }

    fun resetMotionSteering() {
        motionEstimator.reset()
        currentWheelDegrees = 0f
        curvature = 0f
        invalidate()
    }

    fun setSteeringDegrees(degrees: Float) {
        steeringResolver.setLegacySteeringDegrees(degrees, settings.isSteeringInverted)
        invalidate()
    }

    /**
     * Front ROAD WHEEL angle in degrees, after explicit source validation and
     * vehicle calibration; negative = rear path bends left, positive = right.
     */
    fun setVerifiedRoadWheelAngleDegrees(degrees: Float?) {
        steeringResolver.setVerifiedRoadWheelAngleDegrees(degrees)
        invalidate()
    }

    private val animateRunnable = object : Runnable {
        private var lastPrefSig = Int.MIN_VALUE
        override fun run() {
            val now = SystemClock.uptimeMillis()
            val prefSig = (settings.guidelineStyle * 31) xor
                (settings.guidelineScale * 100f).toInt() xor
                (if (settings.isOemWheelDistanceBarsEnabled) 0x10 else 0) xor
                (if (settings.isGuidelinesEnabled) 0x20 else 0) xor
                (if (settings.isMotionCurveEnabled) 0x40 else 0)
            val motionDeg = if (settings.isMotionCurveEnabled) {
                motionEstimator.step(now, settings.isSteeringInverted)
            } else {
                0f
            }
            val targetDeg = steeringResolver.resolveTargetDegrees(motionDeg)
            val prevDeg = currentWheelDegrees
            currentWheelDegrees += 0.35f * (targetDeg - currentWheelDegrees)
            if (abs(currentWheelDegrees) < 0.1f && abs(targetDeg) < 0.1f) {
                currentWheelDegrees = 0f
            }
            curvature = currentWheelDegrees / 35f

            if (prefSig != lastPrefSig || abs(currentWheelDegrees - prevDeg) > 0.02f || abs(currentWheelDegrees) > 0.05f) {
                lastPrefSig = prefSig
                invalidate()
            }
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
            val sm = context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
            sensorManager = sm
            sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
                sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
            }
            sm.getDefaultSensor(Sensor.TYPE_GRAVITY)?.let {
                sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
            }
            isSensorRegistered = true
        } catch (_: Throwable) {}
    }

    private fun unregisterSensors() {
        if (!isSensorRegistered) return
        try {
            sensorManager?.unregisterListener(this)
        } catch (_: Throwable) {}
        isSensorRegistered = false
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
                motionEstimator.onGyroSample(
                    wx = v[0], wy = v[1], wz = v[2],
                    gx = gravityX, gy = gravityY, gz = gravityZ,
                    hasGravity = gravityReady,
                    timestampMs = SystemClock.uptimeMillis()
                )
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

        val bottomY = h * 0.86f
        val topY = h * 0.38f

        val bottomHalfW = (w * 0.30f * scale).coerceIn(dp(60f), w * 0.38f)
        val topHalfW = (w * 0.13f * scale).coerceIn(dp(30f), w * 0.20f)

        val cx = w * 0.5f
        val maxShift = (w * 0.5f - bottomHalfW - dp(24f)).coerceAtLeast(dp(20f))
        val wheelAngle = currentWheelDegrees.toDouble().coerceIn(-35.0, 35.0)
        // Kinematic bicycle model: physically-grounded rear-axle movement.
        val pFull = ReversePathGeometry.sample(3.0, wheelAngle, 2.9, 1.8)
        val pMiddle = ReversePathGeometry.sample(1.5, wheelAngle, 2.9, 1.8)
        val shift = (pFull.centerX.toFloat() * topHalfW / 0.9f * warp)
            .coerceIn(-maxShift, maxShift)
        val midHalfW = (bottomHalfW + topHalfW) * 0.5f
        val midShift = (pMiddle.centerX.toFloat() * midHalfW / 0.9f * warp)
            .coerceIn(-maxShift, maxShift)

        val blX = cx - bottomHalfW
        val brX = cx + bottomHalfW
        val tlX = cx - topHalfW + shift
        val trX = cx + topHalfW + shift

        // Bezier centre at t=0.5 equals bicycle-model projected midpath.
        // C = 2*Pmid - (Pstart+Pend)/2. Preserve approved rail widths.
        val midY = (bottomY + topY) * 0.5f
        val ctrlShift = 2f * midShift - shift * 0.5f
        val ctrlLx = (cx - bottomHalfW + cx - topHalfW) * 0.5f + ctrlShift
        val ctrlRx = (cx + bottomHalfW + cx + topHalfW) * 0.5f + ctrlShift

        leftPath.reset()
        leftPath.moveTo(blX, bottomY)
        leftPath.quadTo(ctrlLx, midY, tlX, topY)

        rightPath.reset()
        rightPath.moveTo(brX, bottomY)
        rightPath.quadTo(ctrlRx, midY, trX, topY)

        when (style) {
            CameraSettings.STYLE_OEM_WHEEL -> {
                drawOemWheelTrack(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, wheelAngle, scale)
            }
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
     * MẪU 6: Đường bánh xe OEM (2 viền thân xe mảnh + khe hở + 2 dải bánh xe xanh + thanh đỏ 0.5m cố định)
     */
    private fun drawOemWheelTrack(
        canvas: Canvas,
        cx: Float,
        bottomY: Float,
        topY: Float,
        bottomHalfW: Float,
        topHalfW: Float,
        wheelAngle: Double,
        scale: Float
    ) {
        val sMin = 0.35
        val sMax = 2.90
        val steps = 20
        val outerOffset = 0.92
        val tireOuterOffset = 0.84
        val tireInnerOffset = 0.56
        val warpDeg = (wheelAngle * settings.warpFactor.toDouble()).coerceIn(-35.0, 35.0)

        fun buildRibbon(innerU: Double, outerU: Double) {
            wheelRibbonPath.reset()
            for (i in 0..steps) {
                val s = sMin + (sMax - sMin) * (i.toDouble() / steps)
                val wt = ReversePathGeometry.sampleTrackPoint(s, warpDeg, 2.9, innerU)
                val pt = ReversePathGeometry.worldToScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW)
                if (i == 0) wheelRibbonPath.moveTo(pt.x, pt.y) else wheelRibbonPath.lineTo(pt.x, pt.y)
            }
            for (i in steps downTo 0) {
                val s = sMin + (sMax - sMin) * (i.toDouble() / steps)
                val wt = ReversePathGeometry.sampleTrackPoint(s, warpDeg, 2.9, outerU)
                val pt = ReversePathGeometry.worldToScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW)
                wheelRibbonPath.lineTo(pt.x, pt.y)
            }
            wheelRibbonPath.close()
            canvas.drawPath(wheelRibbonPath, wheelFillPaint)
            wheelEdgePaint.strokeWidth = dp(1.2f) * scale
            canvas.drawPath(wheelRibbonPath, wheelEdgePaint)
        }

        fun buildRail(path: Path, lateralU: Double) {
            path.reset()
            val railStart = sMin - 0.04
            val railEnd = sMax + 0.06
            for (i in 0..steps) {
                val s = railStart + (railEnd - railStart) * (i.toDouble() / steps)
                val wt = ReversePathGeometry.sampleTrackPoint(s, warpDeg, 2.9, lateralU)
                val pt = ReversePathGeometry.worldToScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW)
                if (i == 0) path.moveTo(pt.x, pt.y) else path.lineTo(pt.x, pt.y)
            }
            outerRailPaint.strokeWidth = dp(3.0f) * scale
            canvas.drawPath(path, outerRailPaint)
        }

        buildRibbon(-tireInnerOffset, -tireOuterOffset)
        buildRibbon(tireInnerOffset, tireOuterOffset)
        buildRail(leftPath, -outerOffset)
        buildRail(rightPath, outerOffset)

        val showMetricBars = settings.isOemWheelDistanceBarsEnabled
        if (showMetricBars) {
            linePaint.color = Color.argb(140, 255, 255, 255)
            linePaint.strokeWidth = dp(2.0f) * scale
            for (d in 0 until 7) {
                val s1 = 0.45 + d * 0.34
                val s2 = s1 + 0.17
                if (s2 > sMax) break
                val w1 = ReversePathGeometry.sampleTrackPoint(s1, warpDeg, 2.9, 0.0)
                val w2 = ReversePathGeometry.sampleTrackPoint(s2, warpDeg, 2.9, 0.0)
                val p1 = ReversePathGeometry.worldToScreen(w1.x, w1.back, cx, bottomY, topY, bottomHalfW, topHalfW)
                val p2 = ReversePathGeometry.worldToScreen(w2.x, w2.back, cx, bottomY, topY, bottomHalfW, topHalfW)
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, linePaint)
            }

            drawCurvedMetricBar(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, warpDeg, 1.25, outerOffset, Color.rgb(234, 179, 8), "1.0m", scale)
            drawCurvedMetricBar(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, warpDeg, 2.15, outerOffset, Color.rgb(34, 197, 94), "1.5m", scale)
        }

        // Fixed horizontal RED rear-bumper clearance bar (~0.5m, stays anchored to car bumper)
        val bLeft = ReversePathGeometry.worldToScreen(-outerOffset, 0.48, cx, bottomY, topY, bottomHalfW, topHalfW)
        val bRight = ReversePathGeometry.worldToScreen(outerOffset, 0.48, cx, bottomY, topY, bottomHalfW, topHalfW)
        linePaint.color = Color.rgb(244, 63, 94)
        linePaint.strokeWidth = dp(4.5f) * scale
        canvas.drawLine(bLeft.x, bLeft.y, bRight.x, bRight.y, linePaint)
        if (showMetricBars) {
            drawBadge(canvas, cx, bLeft.y, "0.5m", Color.rgb(244, 63, 94), scale)
        }
    }

    private fun drawCurvedMetricBar(
        canvas: Canvas,
        cx: Float,
        bottomY: Float,
        topY: Float,
        bottomHalfW: Float,
        topHalfW: Float,
        wheelAngle: Double,
        sMeters: Double,
        outerOffset: Double,
        color: Int,
        label: String,
        scale: Float
    ) {
        crossbarPath.reset()
        val segs = 12
        for (i in 0..segs) {
            val u = -outerOffset + (outerOffset * 2.0) * (i.toDouble() / segs)
            val wt = ReversePathGeometry.sampleTrackPoint(sMeters, wheelAngle, 2.9, u)
            val pt = ReversePathGeometry.worldToScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW)
            if (i == 0) crossbarPath.moveTo(pt.x, pt.y) else crossbarPath.lineTo(pt.x, pt.y)
        }
        linePaint.color = color
        linePaint.strokeWidth = dp(2.8f) * scale
        canvas.drawPath(crossbarPath, linePaint)

        val midW = ReversePathGeometry.sampleTrackPoint(sMeters, wheelAngle, 2.9, 0.0)
        val midP = ReversePathGeometry.worldToScreen(midW.x, midW.back, cx, bottomY, topY, bottomHalfW, topHalfW)
        drawBadge(canvas, midP.x, midP.y, label, color, scale)
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
