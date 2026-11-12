package com.tigeriq.camera;

import java.nio.ByteBuffer;

/**
 * Thread-safe bridge forwarding NV21 IFrameCallback road motion and IMU gyroscope
 * samples into the shared MotionSteeringEstimator.
 */
public final class GuideMotionHub {
    private static final MotionSteeringEstimator ESTIMATOR = new MotionSteeringEstimator();
    private static final byte[] PREV_SAMPLE = new byte[UvcFrameSignalEvidence.ROAD_MOTION_GRID_SIZE];
    private static final byte[] CURR_SAMPLE = new byte[UvcFrameSignalEvidence.ROAD_MOTION_GRID_SIZE];
    private static final Object FRAME_LOCK = new Object();

    private static volatile int sFrameWidth = 0;
    private static volatile int sFrameHeight = 0;
    private static volatile long sLastMotionAtMs = 0L;
    private static boolean sHasPrevSample = false;

    private GuideMotionHub() {}

    public static long monoMs() {
        return System.nanoTime() / 1_000_000L;
    }

    public static void setFrameSize(int width, int height) {
        if (width > 0 && height > 0) {
            if (sFrameWidth != width || sFrameHeight != height) {
                resetVideoMotion();
                sFrameWidth = width;
                sFrameHeight = height;
            }
        }
    }

    public static void resetVideoMotion() {
        synchronized (FRAME_LOCK) {
            sHasPrevSample = false;
            sLastMotionAtMs = 0L;
        }
    }

    public static void resetAll() {
        resetVideoMotion();
        ESTIMATOR.reset();
    }

    public static void onGyroSample(
            float wx, float wy, float wz,
            float gx, float gy, float gz,
            boolean hasGravity) {
        ESTIMATOR.onGyroSample(wx, wy, wz, gx, gy, gz, hasGravity, monoMs());
    }

    public static float stepDegrees(boolean inverted) {
        return ESTIMATOR.step(monoMs(), inverted);
    }

    public static void onUvcFrame(ByteBuffer frame) {
        if (frame == null) return;
        try {
            long now = monoMs();
            synchronized (FRAME_LOCK) {
                if (sLastMotionAtMs > 0L && (now - sLastMotionAtMs) >= 0L && (now - sLastMotionAtMs) < 100L) {
                    return;
                }
                int w = sFrameWidth;
                int h = sFrameHeight;
                int rem = frame.remaining();
                if (w <= 0 || h <= 0 || (long) w * (long) h > rem) {
                    int[] dims = inferNv21Size(rem);
                    if (dims == null) return;
                    w = dims[0];
                    h = dims[1];
                }
                sLastMotionAtMs = now;
                Float score = UvcFrameSignalEvidence.computeRoadMotionScore(frame, w, h, PREV_SAMPLE, CURR_SAMPLE);
                if (score != null) {
                    System.arraycopy(CURR_SAMPLE, 0, PREV_SAMPLE, 0, PREV_SAMPLE.length);
                    if (sHasPrevSample) {
                        ESTIMATOR.onVideoMotionScore(score, now);
                    } else {
                        sHasPrevSample = true;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private static int[] inferNv21Size(int remaining) {
        int[][] common = {
            {1920, 1080}, {1280, 720}, {1024, 768}, {800, 600},
            {720, 576}, {720, 480}, {640, 480}, {320, 240}
        };
        for (int[] c : common) {
            int nv21Bytes = (c[0] * c[1] * 3) / 2;
            if (remaining >= nv21Bytes && remaining <= nv21Bytes + 4096) {
                return c;
            }
        }
        return null;
    }
}
