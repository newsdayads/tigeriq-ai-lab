package com.tigeriq.camera;

import java.nio.ByteBuffer;

/**
 * Non-destructive NV21 lower-road optical luma motion scorer immune to uniform AGC exposure jumps.
 */
public final class UvcFrameSignalEvidence {
    public static final int ROAD_MOTION_GRID_SIZE = 32; // 8 cols x 4 rows across lower road band

    private UvcFrameSignalEvidence() {}

    public static Float computeRoadMotionScore(
            ByteBuffer frame,
            int width,
            int height,
            byte[] previousSample,
            byte[] outSample) {
        if (frame == null || previousSample == null || outSample == null) return null;
        if (width < 16 || height < 16) return null;
        if (previousSample.length < ROAD_MOTION_GRID_SIZE || outSample.length < ROAD_MOTION_GRID_SIZE) {
            return null;
        }
        long pixelCountLong = (long) width * (long) height;
        if (pixelCountLong <= 0L || pixelCountLong > Integer.MAX_VALUE || frame.remaining() < pixelCountLong) {
            return null;
        }

        ByteBuffer read = frame.asReadOnlyBuffer();
        int base = read.position();
        int idx = 0;
        int sumCur = 0;
        int sumPrev = 0;

        for (int row = 0; row < 4; row++) {
            int y = (int) ((0.56f + row * 0.10f) * height);
            if (y < 0) y = 0;
            if (y >= height) y = height - 1;
            int rowBase = base + y * width;
            for (int col = 0; col < 8; col++) {
                int x = (int) ((0.15f + col * 0.10f) * width);
                if (x < 0) x = 0;
                if (x >= width) x = width - 1;
                int lumaCur = read.get(rowBase + x) & 0xFF;
                int lumaPrev = previousSample[idx] & 0xFF;
                outSample[idx] = (byte) lumaCur;
                sumCur += lumaCur;
                sumPrev += lumaPrev;
                idx++;
            }
        }

        float meanCur = sumCur / (float) ROAD_MOTION_GRID_SIZE;
        float meanPrev = sumPrev / (float) ROAD_MOTION_GRID_SIZE;
        float mad = 0f;
        for (int i = 0; i < ROAD_MOTION_GRID_SIZE; i++) {
            float cur = (outSample[i] & 0xFF) - meanCur;
            float prev = (previousSample[i] & 0xFF) - meanPrev;
            mad += Math.abs(cur - prev);
        }
        return mad / (float) ROAD_MOTION_GRID_SIZE;
    }
}
