package com.tigeriq.camera;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import com.ultracar.dexsplit.ui.ParkingGuidelinesOverlayView;

/**
 * Vector Canvas OEM Tire-Track guideline overlay for UltraCarHCM.
 * Features thin blue outer rails, translucent blue tire ribbons, fixed 0.5m red bumper bar,
 * dynamic curved white dashed centerline, curved 1.0m/1.5m distance arcs with side-aligned
 * readable pills, and vibration-gated Gyro + UVC road-motion curving.
 */
public final class NativeGuideWarpView extends ParkingGuidelinesOverlayView implements SensorEventListener {
    private static volatile float sDebugPreviewDegrees = Float.NaN;

    private static final double WHEELBASE_METERS = 2.60;
    private static final double S_MIN = 0.0;
    private static final double S_MAX = ReversePathGeometry.OEM_S_MAX_METERS;
    private static final double REF_BACK_METERS = ReversePathGeometry.OEM_S_MAX_METERS;
    private static final double REF_HALF_W_METERS = 0.92;
    private static final double BARREL_BOW = ReversePathGeometry.OEM_BARREL_BOW;
    private static final double S_RED = ReversePathGeometry.OEM_S_RED_METERS;
    private static final double S_YELLOW = ReversePathGeometry.OEM_S_YELLOW_METERS;
    private static final double S_GREEN = ReversePathGeometry.OEM_S_GREEN_METERS;
    private static final double OUTER_U = 0.92;
    private static final double TIRE_OUTER_U = 0.80;
    private static final double TIRE_INNER_U = 0.62;
    private static final int TRACK_STEPS = 36;
    private static final int BAR_STEPS = 18;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Paint ribbonFillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ribbonEdgePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint railPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint haloPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pillFillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pillBorderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private final Path ribbonPath = new Path();
    private final Path railPath = new Path();
    private final Path centerDashPath = new Path();
    private final Path barPath = new Path();
    private final RectF pillRect = new RectF();

    private LinearGradient cachedFillGradient = null;
    private LinearGradient cachedEdgeGradient = null;
    private LinearGradient cachedRailGradient = null;
    private float cachedGradGreenY = -1f;
    private float cachedGradYellowY = -1f;
    private float cachedGradRedY = -1f;

    private SensorManager sensorManager = null;
    private boolean sensorRegistered = false;
    private float gravityX = 0f;
    private float gravityY = 9.81f;
    private float gravityZ = 0f;
    private boolean gravityReady = false;

    private float currentWheelDegrees = 0f;
    private float lastDrawnDegrees = 0f;
    private boolean attached = false;

    private final Runnable animateRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (!attached) return;
                float preview = sDebugPreviewDegrees;
                float targetDeg = Float.isFinite(preview)
                    ? clampF(preview, -38f, 38f)
                    : GuideMotionHub.stepDegrees(true);
                currentWheelDegrees += 0.52f * (targetDeg - currentWheelDegrees);
                if (Math.abs(currentWheelDegrees) < 0.1f && Math.abs(targetDeg) < 0.1f) {
                    currentWheelDegrees = 0f;
                }
                if (Math.abs(currentWheelDegrees - lastDrawnDegrees) > 0.03f) {
                    invalidate();
                }
                mainHandler.postDelayed(this, 33L);
            } catch (Throwable ignored) {
            }
        }
    };

    public static void setDebugPreviewDegrees(float degrees) {
        sDebugPreviewDegrees = degrees;
    }

    public NativeGuideWarpView(Context context) {
        super(context);
        try {
            setWillNotDraw(false);

            ribbonFillPaint.setStyle(Paint.Style.FILL);
            ribbonEdgePaint.setStyle(Paint.Style.STROKE);
            ribbonEdgePaint.setStrokeCap(Paint.Cap.ROUND);
            ribbonEdgePaint.setStrokeJoin(Paint.Join.ROUND);

            railPaint.setStyle(Paint.Style.STROKE);
            railPaint.setStrokeCap(Paint.Cap.ROUND);
            railPaint.setStrokeJoin(Paint.Join.ROUND);

            haloPaint.setStyle(Paint.Style.STROKE);
            haloPaint.setStrokeCap(Paint.Cap.ROUND);
            haloPaint.setStrokeJoin(Paint.Join.ROUND);

            linePaint.setStyle(Paint.Style.STROKE);
            linePaint.setStrokeCap(Paint.Cap.ROUND);
            linePaint.setStrokeJoin(Paint.Join.ROUND);

            pillFillPaint.setStyle(Paint.Style.FILL);
            pillFillPaint.setColor(Color.argb(214, 10, 14, 24));

            pillBorderPaint.setStyle(Paint.Style.STROKE);

            textPaint.setStyle(Paint.Style.FILL);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setFakeBoldText(true);
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        try {
            attached = true;
            registerSensors();
            mainHandler.removeCallbacks(animateRunnable);
            mainHandler.post(animateRunnable);
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onDetachedFromWindow() {
        try {
            attached = false;
            mainHandler.removeCallbacks(animateRunnable);
            unregisterSensors();
            GuideMotionHub.resetAll();
            cachedFillGradient = null;
            cachedEdgeGradient = null;
            cachedRailGradient = null;
        } catch (Throwable ignored) {
        }
        super.onDetachedFromWindow();
    }

    private void registerSensors() {
        if (sensorRegistered) return;
        try {
            Context appCtx = getContext().getApplicationContext();
            SensorManager sm = (SensorManager) appCtx.getSystemService(Context.SENSOR_SERVICE);
            if (sm == null) return;
            sensorManager = sm;
            Sensor gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            if (gyro != null) {
                sm.registerListener(this, gyro, SensorManager.SENSOR_DELAY_UI);
            }
            Sensor grav = sm.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (grav != null) {
                sm.registerListener(this, grav, SensorManager.SENSOR_DELAY_UI);
            }
            sensorRegistered = true;
        } catch (Throwable ignored) {
        }
    }

    private void unregisterSensors() {
        if (!sensorRegistered) return;
        try {
            if (sensorManager != null) {
                sensorManager.unregisterListener(this);
            }
        } catch (Throwable ignored) {
        }
        sensorRegistered = false;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        try {
            if (event == null || event.sensor == null || event.values == null || event.values.length < 3) {
                return;
            }
            int type = event.sensor.getType();
            if (type == Sensor.TYPE_GRAVITY) {
                gravityX = event.values[0];
                gravityY = event.values[1];
                gravityZ = event.values[2];
                gravityReady = true;
            } else if (type == Sensor.TYPE_GYROSCOPE) {
                GuideMotionHub.onGyroSample(
                    event.values[0], event.values[1], event.values[2],
                    gravityX, gravityY, gravityZ,
                    gravityReady
                );
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        try {
            if (canvas == null) return;
            int w = getWidth();
            int h = getHeight();
            if (w < 60 || h < 60) return;

            float preview = sDebugPreviewDegrees;
            double wheelDeg = Float.isFinite(preview)
                ? clampF(preview, -38f, 38f)
                : currentWheelDegrees;
            lastDrawnDegrees = (float) wheelDeg;

            float minDim = Math.min(w, h);
            float uiScale = clampF(minDim / 440f, 0.48f, 1.55f);

            float bottomY = h * ReversePathGeometry.OEM_BOTTOM_Y_FRAC;
            float span = (h > w * 1.05f)
                ? Math.min(h * ReversePathGeometry.OEM_SPAN_FRAC, w * ReversePathGeometry.OEM_PORTRAIT_SPAN_MAX_WIDTH_FRAC)
                : h * ReversePathGeometry.OEM_SPAN_FRAC;
            float topY = bottomY - span;
            float bottomHalfW = w * ReversePathGeometry.OEM_BOTTOM_HALF_W_FRAC;
            float topHalfW = w * ReversePathGeometry.OEM_TOP_HALF_W_FRAC;
            float cx = w * ReversePathGeometry.OEM_CENTER_X_FRAC;

            float yGreen = toScreen(0.0, S_GREEN, cx, bottomY, topY, bottomHalfW, topHalfW).y;
            float yYellow = toScreen(0.0, S_YELLOW, cx, bottomY, topY, bottomHalfW, topHalfW).y;
            float yRed = toScreen(0.0, S_RED, cx, bottomY, topY, bottomHalfW, topHalfW).y;

            // 1. Two translucent vertical-gradient tire-track ribbons (Green -> Yellow -> Red)
            ensureZoneGradients(yGreen, yYellow, yRed);
            drawTireRibbon(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg, -TIRE_INNER_U, -TIRE_OUTER_U, uiScale);
            drawTireRibbon(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg, TIRE_INNER_U, TIRE_OUTER_U, uiScale);

            // 2. Gap + two crisp outer body guard rails with synchronized vertical gradient
            drawOuterRail(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg, -OUTER_U, uiScale);
            drawOuterRail(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg, OUTER_U, uiScale);

            // 3. Center dashed trajectory axis
            drawCenterTrajectory(canvas, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg, uiScale);

            // 4. Curved 1.5m (emerald) and 1.0m (amber) crossbars + side pills
            drawCurvedMetricBar(canvas, w, h, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg,
                S_GREEN, Color.rgb(52, 211, 153), "1.5m", uiScale);
            drawCurvedMetricBar(canvas, w, h, cx, bottomY, topY, bottomHalfW, topHalfW, wheelDeg,
                S_YELLOW, Color.rgb(250, 204, 21), "1.0m", uiScale);

            // 5. Fixed 0.5m RED rear bumper clearance bar (tracks & rails continue below it to bumper)
            ReversePathGeometry.ScreenPoint bL = toScreen(-OUTER_U, S_RED, cx, bottomY, topY, bottomHalfW, topHalfW);
            ReversePathGeometry.ScreenPoint bR = toScreen(OUTER_U, S_RED, cx, bottomY, topY, bottomHalfW, topHalfW);
            int redColor = Color.rgb(244, 63, 94);
            haloPaint.setColor(Color.argb(124, 0, 0, 0));
            haloPaint.setStrokeWidth(5.8f * uiScale);
            canvas.drawLine(bL.x, bL.y, bR.x, bR.y, haloPaint);
            linePaint.setColor(redColor);
            linePaint.setStrokeWidth(3.8f * uiScale);
            canvas.drawLine(bL.x, bL.y, bR.x, bR.y, linePaint);
            drawSideDistanceBadge(canvas, w, h, bR.x, bR.y, redColor, "0.5m", uiScale);
        } catch (Throwable ignored) {
        }
    }

    private static ReversePathGeometry.ScreenPoint toScreen(
            double worldX, double worldBack,
            float cx, float bottomY, float topY, float bottomHalfW, float topHalfW) {
        return ReversePathGeometry.worldToScreen(
            worldX, worldBack, cx, bottomY, topY, bottomHalfW, topHalfW,
            REF_BACK_METERS, REF_HALF_W_METERS, BARREL_BOW
        );
    }

    private void ensureZoneGradients(float yGreen, float yYellow, float yRed) {
        if (cachedFillGradient == null
                || Math.abs(cachedGradGreenY - yGreen) > 1f
                || Math.abs(cachedGradYellowY - yYellow) > 1f
                || Math.abs(cachedGradRedY - yRed) > 1f) {
            cachedGradGreenY = yGreen;
            cachedGradYellowY = yYellow;
            cachedGradRedY = yRed;
            float span = Math.max(4f, yRed - yGreen);
            float midStop = clampF((yYellow - yGreen) / span, 0.1f, 0.9f);
            float[] stops = new float[]{0f, midStop, 1f};

            int[] fillColors = new int[]{
                Color.argb(66, 34, 211, 118),
                Color.argb(73, 250, 204, 21),
                Color.argb(80, 244, 63, 94)
            };
            int[] edgeColors = new int[]{
                Color.argb(145, 34, 211, 118),
                Color.argb(150, 250, 204, 21),
                Color.argb(155, 244, 63, 94)
            };
            int[] railColors = new int[]{
                Color.argb(230, 34, 211, 118),
                Color.argb(232, 250, 204, 21),
                Color.argb(235, 244, 63, 94)
            };

            cachedFillGradient = new LinearGradient(0f, yGreen, 0f, yGreen + span, fillColors, stops, Shader.TileMode.CLAMP);
            cachedEdgeGradient = new LinearGradient(0f, yGreen, 0f, yGreen + span, edgeColors, stops, Shader.TileMode.CLAMP);
            cachedRailGradient = new LinearGradient(0f, yGreen, 0f, yGreen + span, railColors, stops, Shader.TileMode.CLAMP);
            ribbonFillPaint.setShader(cachedFillGradient);
            ribbonEdgePaint.setShader(cachedEdgeGradient);
            railPaint.setShader(cachedRailGradient);
        }
    }

    private void drawTireRibbon(
            Canvas canvas,
            float cx, float bottomY, float topY, float bottomHalfW, float topHalfW,
            double wheelDeg, double innerU, double outerU, float uiScale) {
        ribbonPath.reset();
        for (int i = 0; i <= TRACK_STEPS; i++) {
            double s = S_MIN + (S_MAX - S_MIN) * (i / (double) TRACK_STEPS);
            ReversePathGeometry.TrackPoint wt = ReversePathGeometry.sampleTrackPoint(s, wheelDeg, WHEELBASE_METERS, innerU);
            ReversePathGeometry.ScreenPoint pt = toScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            if (i == 0) ribbonPath.moveTo(pt.x, pt.y); else ribbonPath.lineTo(pt.x, pt.y);
        }
        for (int i = TRACK_STEPS; i >= 0; i--) {
            double s = S_MIN + (S_MAX - S_MIN) * (i / (double) TRACK_STEPS);
            ReversePathGeometry.TrackPoint wt = ReversePathGeometry.sampleTrackPoint(s, wheelDeg, WHEELBASE_METERS, outerU);
            ReversePathGeometry.ScreenPoint pt = toScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            ribbonPath.lineTo(pt.x, pt.y);
        }
        ribbonPath.close();
        canvas.drawPath(ribbonPath, ribbonFillPaint);
        ribbonEdgePaint.setStrokeWidth(1.4f * uiScale);
        canvas.drawPath(ribbonPath, ribbonEdgePaint);
    }

    private void drawOuterRail(
            Canvas canvas,
            float cx, float bottomY, float topY, float bottomHalfW, float topHalfW,
            double wheelDeg, double lateralU, float uiScale) {
        railPath.reset();
        double a = S_MIN;
        double b = S_MAX + 0.04;
        for (int i = 0; i <= TRACK_STEPS; i++) {
            double s = a + (b - a) * (i / (double) TRACK_STEPS);
            ReversePathGeometry.TrackPoint wt = ReversePathGeometry.sampleTrackPoint(s, wheelDeg, WHEELBASE_METERS, lateralU);
            ReversePathGeometry.ScreenPoint pt = toScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            if (i == 0) railPath.moveTo(pt.x, pt.y); else railPath.lineTo(pt.x, pt.y);
        }
        haloPaint.setColor(Color.argb(104, 0, 0, 0));
        haloPaint.setStrokeWidth(4.7f * uiScale);
        canvas.drawPath(railPath, haloPaint);
        railPaint.setStrokeWidth(2.9f * uiScale);
        canvas.drawPath(railPath, railPaint);
    }

    private void drawCenterTrajectory(
            Canvas canvas,
            float cx, float bottomY, float topY, float bottomHalfW, float topHalfW,
            double wheelDeg, float uiScale) {
        haloPaint.setColor(Color.argb(122, 0, 0, 0));
        haloPaint.setStrokeWidth(3.8f * uiScale);
        linePaint.setColor(Color.argb(232, 255, 255, 255));
        linePaint.setStrokeWidth(2.1f * uiScale);

        for (int d = 0; d < 9; d++) {
            double s0 = 0.14 + d * 0.250;
            double s1 = Math.min(S_MAX - 0.02, s0 + 0.135);
            if (s0 >= s1) break;
            double sm = (s0 + s1) * 0.5;
            ReversePathGeometry.TrackPoint w0 = ReversePathGeometry.sampleTrackPoint(s0, wheelDeg, WHEELBASE_METERS, 0.0);
            ReversePathGeometry.TrackPoint wm = ReversePathGeometry.sampleTrackPoint(sm, wheelDeg, WHEELBASE_METERS, 0.0);
            ReversePathGeometry.TrackPoint w1 = ReversePathGeometry.sampleTrackPoint(s1, wheelDeg, WHEELBASE_METERS, 0.0);
            ReversePathGeometry.ScreenPoint p0 = toScreen(w0.x, w0.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            ReversePathGeometry.ScreenPoint pm = toScreen(wm.x, wm.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            ReversePathGeometry.ScreenPoint p1 = toScreen(w1.x, w1.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            centerDashPath.reset();
            centerDashPath.moveTo(p0.x, p0.y);
            centerDashPath.lineTo(pm.x, pm.y);
            centerDashPath.lineTo(p1.x, p1.y);
            canvas.drawPath(centerDashPath, haloPaint);
            canvas.drawPath(centerDashPath, linePaint);
        }
    }

    private void drawCurvedMetricBar(
            Canvas canvas, int viewW, int viewH,
            float cx, float bottomY, float topY, float bottomHalfW, float topHalfW,
            double wheelDeg, double sMeters, int color, String label, float uiScale) {
        barPath.reset();
        ReversePathGeometry.ScreenPoint rightPt = null;
        for (int i = 0; i <= BAR_STEPS; i++) {
            double u = -OUTER_U + (OUTER_U * 2.0) * (i / (double) BAR_STEPS);
            ReversePathGeometry.TrackPoint wt = ReversePathGeometry.sampleTrackPoint(sMeters, wheelDeg, WHEELBASE_METERS, u);
            ReversePathGeometry.ScreenPoint pt = toScreen(wt.x, wt.back, cx, bottomY, topY, bottomHalfW, topHalfW);
            if (i == 0) barPath.moveTo(pt.x, pt.y); else barPath.lineTo(pt.x, pt.y);
            if (i == BAR_STEPS) rightPt = pt;
        }
        haloPaint.setColor(Color.argb(110, 0, 0, 0));
        haloPaint.setStrokeWidth(3.6f * uiScale);
        canvas.drawPath(barPath, haloPaint);
        linePaint.setColor(color);
        linePaint.setStrokeWidth(2.1f * uiScale);
        canvas.drawPath(barPath, linePaint);

        if (rightPt != null) {
            drawSideDistanceBadge(canvas, viewW, viewH, rightPt.x, rightPt.y, color, label, uiScale);
        }
    }

    private void drawSideDistanceBadge(
            Canvas canvas, int viewW, int viewH,
            float anchorX, float anchorY, int color, String label, float uiScale) {
        float minDim = Math.min(viewW, viewH);
        float textSize = clampF(11.5f * uiScale, 9.5f, Math.min(24f, minDim * 0.048f));
        textPaint.setTextSize(textSize);
        float textW = textPaint.measureText(label);
        float pillW = textW + 11f * uiScale;
        float pillH = textSize + 6.0f * uiScale;
        float minPad = 5f * uiScale;

        float by = clampF(anchorY, pillH * 0.5f + minPad, viewH - pillH * 0.5f - minPad);
        // Reserve modest bottom-right corner clearance (~11% height) without pushing pills into center lane
        float cornerBand = Math.min(viewH * 0.13f, 44f * uiScale);
        float rightSafePad = (by + pillH * 0.5f > viewH - cornerBand)
            ? Math.min(viewW * 0.11f, cornerBand + 2f * uiScale)
            : minPad;
        float preferredCenterX = anchorX + 5f * uiScale + pillW * 0.5f;
        float maxCenterX = Math.max(pillW * 0.5f + minPad, viewW - rightSafePad - pillW * 0.5f);
        float bx = Math.min(preferredCenterX, maxCenterX);

        float pillLeft = bx - pillW * 0.5f;
        if (pillLeft > anchorX + 2f * uiScale) {
            linePaint.setColor(color);
            linePaint.setStrokeWidth(1.6f * uiScale);
            canvas.drawLine(anchorX, by, pillLeft, by, linePaint);
        }

        pillRect.set(pillLeft, by - pillH * 0.5f, bx + pillW * 0.5f, by + pillH * 0.5f);
        float cornerR = 4.5f * uiScale;
        canvas.drawRoundRect(pillRect, cornerR, cornerR, pillFillPaint);

        pillBorderPaint.setColor(color);
        pillBorderPaint.setStrokeWidth(1.4f * uiScale);
        canvas.drawRoundRect(pillRect, cornerR, cornerR, pillBorderPaint);

        textPaint.setColor(color);
        Paint.FontMetrics fm = textPaint.getFontMetrics();
        float textY = by - (fm.ascent + fm.descent) * 0.5f;
        canvas.drawText(label, bx, textY, textPaint);
    }

    private static float clampF(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
