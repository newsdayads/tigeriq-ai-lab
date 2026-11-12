package com.tigeriq.camera;

/**
 * Gravity-aligned gyroscope yaw estimator with UVC road-texture motion gating
 * and calm MEMS bias tracking to prevent idle stationary vibration curvature.
 */
public final class MotionSteeringEstimator {
    private float biasRadPerSec = 0f;
    private float yawSlowRadPerSec = 0f;
    private long lastGyroMs = 0L;
    private long lastStepMs = 0L;
    private long turnHoldStartMs = 0L;
    private int turnHoldSign = 0;
    private float baseDegrees = 0f;

    private volatile float lastMotionScore = 0f;
    private volatile long lastMotionMs = 0L;

    private static float clamp(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static long clampL(long v, long lo, long hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    public synchronized void reset() {
        yawSlowRadPerSec = 0f;
        lastGyroMs = 0L;
        lastStepMs = 0L;
        turnHoldStartMs = 0L;
        turnHoldSign = 0;
        baseDegrees = 0f;
    }

    public void onVideoMotionScore(float score, long timestampMs) {
        if (!Float.isFinite(score) || score < 0f) return;
        lastMotionScore = score;
        lastMotionMs = timestampMs;
    }

    public synchronized void onGyroSample(
            float wx, float wy, float wz,
            float gx, float gy, float gz,
            boolean hasGravity,
            long timestampMs) {
        float gNormSq = gx * gx + gy * gy + gz * gz;
        float rawYaw = (hasGravity && gNormSq > 25f)
            ? (wx * gx + wy * gy + wz * gz) / (float) Math.sqrt(gNormSq)
            : wy;
        if (!Float.isFinite(rawYaw)) return;
        float clampedYaw = clamp(rawYaw, -4.0f, 4.0f);

        float dtSec;
        if (lastGyroMs == 0L || timestampMs <= lastGyroMs) {
            dtSec = 0.03f;
        } else {
            long delta = timestampMs - lastGyroMs;
            if (delta > 1000L) {
                yawSlowRadPerSec = 0f;
                turnHoldStartMs = 0L;
                turnHoldSign = 0;
                dtSec = 0.03f;
            } else {
                dtSec = clampL(delta, 1L, 250L) / 1000f;
            }
        }
        lastGyroMs = timestampMs;

        if (Math.abs(clampedYaw - biasRadPerSec) < 0.028f && Math.abs(yawSlowRadPerSec) < 0.035f) {
            float biasAlpha = clamp(dtSec / 1.2f, 0.005f, 0.05f);
            biasRadPerSec += biasAlpha * (clampedYaw - biasRadPerSec);
        }

        float cleanYaw = clampedYaw - biasRadPerSec;
        float lpfAlpha = clamp(dtSec / (0.075f + dtSec), 0.08f, 0.82f);
        yawSlowRadPerSec += lpfAlpha * (cleanYaw - yawSlowRadPerSec);

        float activeDeadband = resolveDeadband(timestampMs);
        float absYaw = Math.abs(yawSlowRadPerSec);
        if (absYaw > activeDeadband) {
            int sign = yawSlowRadPerSec > 0f ? 1 : -1;
            if (sign != turnHoldSign) {
                turnHoldSign = sign;
                turnHoldStartMs = timestampMs;
            }
        } else {
            turnHoldSign = 0;
            turnHoldStartMs = 0L;
        }
    }

    public synchronized float step(long nowMs, boolean inverted) {
        float dtSec = (lastStepMs == 0L || nowMs <= lastStepMs)
            ? 0.033f
            : clampL(nowMs - lastStepMs, 1L, 250L) / 1000f;
        lastStepMs = nowMs;

        if (lastGyroMs > 0L && nowMs - lastGyroMs > 450L) {
            float decayAlpha = clamp(dtSec / (0.18f + dtSec), 0.05f, 0.70f);
            yawSlowRadPerSec *= (1f - decayAlpha);
            if (Math.abs(yawSlowRadPerSec) < 0.01f) yawSlowRadPerSec = 0f;
            turnHoldSign = 0;
            turnHoldStartMs = 0L;
        }

        float activeDeadband = resolveDeadband(nowMs);
        long confirmMs = resolveConfirmMs(nowMs);
        float absYaw = Math.abs(yawSlowRadPerSec);
        float targetBase;
        if (turnHoldSign != 0 && turnHoldStartMs > 0L
                && absYaw > activeDeadband
                && nowMs - turnHoldStartMs >= confirmMs) {
            float dir = (yawSlowRadPerSec < 0f) ? 1f : -1f;
            double excess = Math.max(0.0, absYaw - activeDeadband);
            float strength = clamp((float) (Math.pow(excess / 0.12, 0.72) * 34.0), 0f, 38f);
            targetBase = dir * strength;
        } else {
            targetBase = 0f;
        }

        float tau;
        if (targetBase == 0f) {
            tau = 0.09f;
        } else if (Math.abs(targetBase) > Math.abs(baseDegrees)) {
            tau = 0.055f;
        } else {
            tau = 0.11f;
        }
        float smoothAlpha = clamp(dtSec / (tau + dtSec), 0.12f, 0.85f);
        baseDegrees += smoothAlpha * (targetBase - baseDegrees);
        if (Math.abs(baseDegrees) < 0.35f && targetBase == 0f) {
            baseDegrees = 0f;
        }
        return inverted ? -baseDegrees : baseDegrees;
    }

    private float resolveDeadband(long nowMs) {
        long age = nowMs - lastMotionMs;
        if (lastMotionMs <= 0L || age < 0L || age > 600L) return 0.025f;
        if (lastMotionScore >= 1.8f) return 0.020f;
        return 0.028f;
    }

    private long resolveConfirmMs(long nowMs) {
        long age = nowMs - lastMotionMs;
        if (lastMotionMs <= 0L || age < 0L || age > 600L) return 25L;
        if (lastMotionScore >= 1.8f) return 15L;
        return 30L;
    }
}
