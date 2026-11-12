package com.tigeriq.camera;

/**
 * Concentric kinematic bicycle model referenced to the rear axle with
 * projective floor-to-screen trapezoid mapping.
 */
public final class ReversePathGeometry {
    /** Single-source calibrated OEM straight-rail overlay geometry fractions & world ranges. */
    public static final double OEM_BARREL_BOW = 0.0;
    public static final double OEM_S_MAX_METERS = 2.40;
    public static final double OEM_S_RED_METERS = 0.50;
    public static final double OEM_S_YELLOW_METERS = 1.00;
    public static final double OEM_S_GREEN_METERS = 1.50;
    public static final float OEM_CENTER_X_FRAC = 0.514f;
    public static final float OEM_BOTTOM_Y_FRAC = 0.996f;
    public static final float OEM_SPAN_FRAC = 0.688f;
    public static final float OEM_PORTRAIT_SPAN_MAX_WIDTH_FRAC = 0.82f;
    public static final float OEM_BOTTOM_HALF_W_FRAC = 0.530f;
    public static final float OEM_TOP_HALF_W_FRAC = 0.165f;

    private ReversePathGeometry() {}

    public static final class TrackPoint {
        public final double x;
        public final double back;

        public TrackPoint(double x, double back) {
            this.x = x;
            this.back = back;
        }
    }

    public static final class ScreenPoint {
        public final float x;
        public final float y;

        public ScreenPoint(float x, float y) {
            this.x = x;
            this.y = y;
        }
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static float clampF(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** Computes concentric offset point along rear-axle bicycle arc for any tire or rail offset. */
    public static TrackPoint sampleTrackPoint(
            double distanceBack,
            double roadWheelDegrees,
            double wheelbaseMeters,
            double lateralOffsetMeters) {
        double safeBack = clamp(distanceBack, 0.0, 6.0);
        double safeAngle = clamp(roadWheelDegrees, -48.0, 48.0);
        double safeWheelbase = clamp(wheelbaseMeters, 1.5, 5.0);
        double safeOffset = clamp(lateralOffsetMeters, -1.5, 1.5);
        double k = Math.tan(safeAngle * Math.PI / 180.0) / safeWheelbase;
        double heading = k * safeBack;
        double x = Math.abs(k) < 1e-9 ? 0.0 : (1.0 - Math.cos(heading)) / k;
        double backwards = Math.abs(k) < 1e-9 ? safeBack : Math.sin(heading) / k;
        return new TrackPoint(
            x + safeOffset * Math.cos(heading),
            backwards - safeOffset * Math.sin(heading)
        );
    }

    /** Projects floor world meters (x right, back away from bumper) onto Canvas coordinates. */
    public static ScreenPoint worldToScreen(
            double worldX,
            double worldBack,
            float cx,
            float bottomY,
            float topY,
            float bottomHalfW,
            float topHalfW) {
        return worldToScreen(worldX, worldBack, cx, bottomY, topY, bottomHalfW, topHalfW, 3.0, 0.90);
    }

    public static ScreenPoint worldToScreen(
            double worldX,
            double worldBack,
            float cx,
            float bottomY,
            float topY,
            float bottomHalfW,
            float topHalfW,
            double referenceDistanceBack,
            double referenceHalfWidthMeters) {
        return worldToScreen(
            worldX, worldBack, cx, bottomY, topY, bottomHalfW, topHalfW,
            referenceDistanceBack, referenceHalfWidthMeters, 0.0
        );
    }

    public static ScreenPoint worldToScreen(
            double worldX,
            double worldBack,
            float cx,
            float bottomY,
            float topY,
            float bottomHalfW,
            float topHalfW,
            double referenceDistanceBack,
            double referenceHalfWidthMeters,
            double barrelBow) {
        float safeBottomHalfW = Math.max(20f, bottomHalfW);
        float maxTopHalfW = safeBottomHalfW * 0.92f;
        float minTopHalfW = Math.min(10f, maxTopHalfW);
        float safeTopHalfW = clampF(topHalfW, minTopHalfW, maxTopHalfW);
        double ratio = safeBottomHalfW / (double) safeTopHalfW;
        double z0 = Math.max(0.5, referenceDistanceBack) / Math.max(0.05, ratio - 1.0);
        double zCam = Math.max(0.1, Math.max(0.0, worldBack) + z0);
        float tPersp = (float) (z0 / zCam);
        float perspSpan = Math.max(0.05f, 1.0f - (safeTopHalfW / safeBottomHalfW));
        float uY = (1.0f - tPersp) / perspSpan;
        float screenY = bottomY - uY * (bottomY - topY);
        double uClamped = clamp(uY, 0.0, 1.0);
        double linearHalfW = safeBottomHalfW * tPersp;
        double safeBow = clamp(barrelBow, -0.35, 0.85);
        double barrelHalfW = linearHalfW + safeBow * (safeBottomHalfW - safeTopHalfW) * uClamped * (1.0 - uClamped);
        float pxPerMeter = (float) (barrelHalfW / Math.max(0.2, referenceHalfWidthMeters));
        return new ScreenPoint(cx + (float) worldX * pxPerMeter, screenY);
    }
}
