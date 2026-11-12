import com.tigeriq.camera.GuideMotionHub;
import com.tigeriq.camera.MotionSteeringEstimator;
import com.tigeriq.camera.ReversePathGeometry;
import com.tigeriq.camera.UvcFrameSignalEvidence;
import java.nio.ByteBuffer;

public class GuideEngineUnitTest {
    private static void check(boolean cond, String msg) {
        if (!cond) {
            throw new AssertionError("FAIL: " + msg);
        }
    }

    private static void checkNear(double actual, double expected, double eps, String msg) {
        if (Math.abs(actual - expected) > eps) {
            throw new AssertionError("FAIL " + msg + ": expected=" + expected + " actual=" + actual);
        }
    }

    private static void testGeometryInvariants() {
        // 1. Straight 0 deg: center x == 0, back == distance
        ReversePathGeometry.TrackPoint p0 = ReversePathGeometry.sampleTrackPoint(2.0, 0.0, 2.9, 0.0);
        checkNear(p0.x, 0.0, 1e-6, "straight center x");
        checkNear(p0.back, 2.0, 1e-6, "straight center back");

        // 2. Right turn (+24 deg): positive x arc, concentric ordering left < center < right
        ReversePathGeometry.TrackPoint left = ReversePathGeometry.sampleTrackPoint(2.0, 24.0, 2.9, -0.92);
        ReversePathGeometry.TrackPoint center = ReversePathGeometry.sampleTrackPoint(2.0, 24.0, 2.9, 0.0);
        ReversePathGeometry.TrackPoint right = ReversePathGeometry.sampleTrackPoint(2.0, 24.0, 2.9, 0.92);
        check(center.x > 0.2, "right turn bends positive x: " + center.x);
        check(left.x < center.x && center.x < right.x, "concentric ordering preserved");

        // 3. Symmetry left (-24 deg) vs right (+24 deg)
        ReversePathGeometry.TrackPoint centerLeft = ReversePathGeometry.sampleTrackPoint(2.0, -24.0, 2.9, 0.0);
        checkNear(centerLeft.x, -center.x, 1e-6, "symmetric turn x");
        checkNear(centerLeft.back, center.back, 1e-6, "symmetric turn back");

        // 4. Tiny window worldToScreen clamping never throws and stays finite
        ReversePathGeometry.ScreenPoint sp = ReversePathGeometry.worldToScreen(
            0.0, 1.5, 100f, 130f, 65f, 4f, 50f
        );
        check(Float.isFinite(sp.x) && Float.isFinite(sp.y), "tiny window screen point finite");

        // 5. OEM v1.2.11 zero-steer calibration constants & straight colinearity (no barrel oval bow)
        checkNear(ReversePathGeometry.OEM_BARREL_BOW, 0.0, 1e-9, "zero-steer barrel bow must be 0.0 (straight rails)");
        checkNear(ReversePathGeometry.OEM_S_RED_METERS, 0.50, 1e-6, "0.5m danger bar meters");
        checkNear(ReversePathGeometry.OEM_S_YELLOW_METERS, 1.00, 1e-6, "1.0m amber bar meters");
        checkNear(ReversePathGeometry.OEM_S_GREEN_METERS, 1.50, 1e-6, "1.5m green bar meters");
        checkNear(ReversePathGeometry.OEM_S_MAX_METERS, 2.40, 1e-6, "max range reaches Kia front bumper ~2.4m");

        float w = 1000f, h = 1000f;
        float cx = w * ReversePathGeometry.OEM_CENTER_X_FRAC;
        float botY = h * ReversePathGeometry.OEM_BOTTOM_Y_FRAC;
        float topY = botY - h * ReversePathGeometry.OEM_SPAN_FRAC;
        float botHW = w * ReversePathGeometry.OEM_BOTTOM_HALF_W_FRAC;
        float topHW = w * ReversePathGeometry.OEM_TOP_HALF_W_FRAC;

        ReversePathGeometry.ScreenPoint topOuter = ReversePathGeometry.worldToScreen(
            0.92, ReversePathGeometry.OEM_S_MAX_METERS, cx, botY, topY, botHW, topHW,
            ReversePathGeometry.OEM_S_MAX_METERS, 0.92, ReversePathGeometry.OEM_BARREL_BOW
        );
        checkNear(topOuter.x, cx + topHW, 0.2, "OEM v1.2.11 top outer x == cx + topHalfW");
        checkNear(topOuter.y, 308.0, 0.5, "OEM v1.2.11 topY ~0.308h reaches Kia bumper");

        ReversePathGeometry.ScreenPoint botOuter = ReversePathGeometry.worldToScreen(
            0.92, 0.0, cx, botY, topY, botHW, topHW,
            ReversePathGeometry.OEM_S_MAX_METERS, 0.92, ReversePathGeometry.OEM_BARREL_BOW
        );
        checkNear(botOuter.x, cx + botHW, 0.2, "OEM v1.2.11 bot outer x == cx + bottomHalfW");
        checkNear(botOuter.y, 996.0, 0.2, "OEM v1.2.11 bot outer y == 0.996h");

        // 6. Strict collinear straightness across all distances (deviation < 0.05px on 1000px canvas)
        for (double sCheck : new double[]{0.35, 0.50, 1.00, 1.50, 2.00}) {
            ReversePathGeometry.ScreenPoint midPt = ReversePathGeometry.worldToScreen(
                0.92, sCheck, cx, botY, topY, botHW, topHW,
                ReversePathGeometry.OEM_S_MAX_METERS, 0.92, ReversePathGeometry.OEM_BARREL_BOW
            );
            double frac = (botOuter.y - midPt.y) / (botOuter.y - topOuter.y);
            double lineX = botOuter.x + frac * (topOuter.x - botOuter.x);
            checkNear(midPt.x, lineX, 0.05, "straight rail colinearity at s=" + sCheck);
        }

        // 7. Recalibrated distance bar positions matching Kia & Road OEM overlay (~0.68 red, ~0.52 yellow, ~0.42 green)
        ReversePathGeometry.ScreenPoint pRed = ReversePathGeometry.worldToScreen(
            0.92, ReversePathGeometry.OEM_S_RED_METERS, cx, botY, topY, botHW, topHW,
            ReversePathGeometry.OEM_S_MAX_METERS, 0.92, ReversePathGeometry.OEM_BARREL_BOW
        );
        ReversePathGeometry.ScreenPoint pYel = ReversePathGeometry.worldToScreen(
            0.92, ReversePathGeometry.OEM_S_YELLOW_METERS, cx, botY, topY, botHW, topHW,
            ReversePathGeometry.OEM_S_MAX_METERS, 0.92, ReversePathGeometry.OEM_BARREL_BOW
        );
        ReversePathGeometry.ScreenPoint pGrn = ReversePathGeometry.worldToScreen(
            0.92, ReversePathGeometry.OEM_S_GREEN_METERS, cx, botY, topY, botHW, topHW,
            ReversePathGeometry.OEM_S_MAX_METERS, 0.92, ReversePathGeometry.OEM_BARREL_BOW
        );
        check(pRed.y > 660f && pRed.y < 700f, "0.5m red bar in OEM zone [660..700]: " + pRed.y);
        check(pYel.y > 495f && pYel.y < 535f, "1.0m yellow bar in OEM zone [495..535]: " + pYel.y);
        check(pGrn.y > 395f && pGrn.y < 435f, "1.5m green bar in OEM zone [395..435]: " + pGrn.y);
        check(topOuter.y < pGrn.y && pGrn.y < pYel.y && pYel.y < pRed.y && pRed.y < botOuter.y, "strict distance ordering");

        // 8. Curvature angle range reaches 38 deg without clamping at 35 deg (turning bends straight rail smoothly)
        ReversePathGeometry.TrackPoint p35 = ReversePathGeometry.sampleTrackPoint(2.40, 35.0, 2.60, 0.0);
        ReversePathGeometry.TrackPoint p38 = ReversePathGeometry.sampleTrackPoint(2.40, 38.0, 2.60, 0.0);
        check(p38.x > p35.x + 0.05, "38 deg bends more than 35 deg: p35=" + p35.x + " p38=" + p38.x);
    }

    private static void testEstimatorVibrationGatingAndDecay() {
        MotionSteeringEstimator est = new MotionSteeringEstimator();

        // Idle vibration (alternating small tremor +-0.022 rad/s stays locked at 0)
        long t = 1000L;
        for (int i = 0; i < 20; i++) {
            float vib = (i % 2 == 0) ? 0.022f : -0.022f;
            est.onGyroSample(0f, vib, 0f, 0f, 9.81f, 0f, true, t);
            t += 40L;
        }
        float idleDeg = est.step(t, false);
        checkNear(idleDeg, 0.0, 0.01, "idle vibration stays 0 deg");

        // Stationary (low UVC motion) rejects 0.024 rad/s engine tremor
        est.onVideoMotionScore(0.3f, t);
        for (int i = 0; i < 10; i++) {
            est.onGyroSample(0f, 0.024f, 0f, 0f, 9.81f, 0f, true, t);
            t += 40L;
        }
        float tremorDeg = est.step(t, false);
        checkNear(tremorDeg, 0.0, 0.01, "stationary low-motion rejects 0.024 rad/s tremor");

        // Slow/low-motion gentle turn (-0.065 rad/s, score=0.6f) responds evenly > 10 deg instead of stalling
        est.reset();
        t = 2500L;
        est.onVideoMotionScore(0.6f, t);
        for (int i = 0; i < 10; i++) {
            est.onGyroSample(0f, -0.065f, 0f, 0f, 9.81f, 0f, true, t);
            est.step(t, false);
            t += 35L;
        }
        float slowGentleDeg = est.step(t, false);
        check(slowGentleDeg > 10.0f && slowGentleDeg <= 38.0f, "slow low-motion turn stays sensitive > 10 deg: " + slowGentleDeg);

        // Gentle reversing turn (-0.115 rad/s with moving road texture >= 2.0) bends visibly > 20 deg
        est.reset();
        t = 3000L;
        est.onVideoMotionScore(3.6f, t);
        for (int i = 0; i < 10; i++) {
            est.onGyroSample(0f, -0.115f, 0f, 0f, 9.81f, 0f, true, t);
            est.step(t, false);
            t += 35L;
        }
        float gentleDeg = est.step(t, false);
        check(gentleDeg > 20.0f && gentleDeg <= 38.0f, "gentle turn stronger response > 20 deg: " + gentleDeg);

        // Reversing turn with strong road motion and sustained gyro yaw (-0.30 rad/s) reaches > 34 up to 38 deg
        est.reset();
        t = 5000L;
        est.onVideoMotionScore(4.2f, t);
        for (int i = 0; i < 10; i++) {
            est.onGyroSample(0f, -0.30f, 0f, 0f, 9.81f, 0f, true, t);
            est.step(t, false);
            t += 35L;
        }
        float turningDeg = est.step(t, false);
        check(turningDeg > 34.0f && turningDeg <= 38.0f, "strong turn ratio > 34 up to 38 deg: " + turningDeg);

        // Hub inverted check (used by NativeGuideWarpView) yields opposite sign to direct mode
        GuideMotionHub.resetAll();
        for (int i = 0; i < 6; i++) {
            GuideMotionHub.onGyroSample(0f, -0.25f, 0f, 0f, 9.81f, 0f, true);
            try { Thread.sleep(15L); } catch (InterruptedException ignored) {}
        }
        float hubInv = GuideMotionHub.stepDegrees(true);
        check(hubInv < -5.0f, "hub inverted step yields negative angle on negative gyro: " + hubInv);
        GuideMotionHub.resetAll();

        // Inverted steering flips sign cleanly
        est.reset();
        t = 8000L;
        est.onVideoMotionScore(4.2f, t);
        for (int i = 0; i < 10; i++) {
            est.onGyroSample(0f, -0.30f, 0f, 0f, 9.81f, 0f, true, t);
            est.step(t, true);
            t += 35L;
        }
        float invDeg = est.step(t, true);
        checkNear(invDeg, -turningDeg, 0.5, "inverted steering flips sign");

        // Silence > 450ms smoothly decays back toward 0 deg
        for (int i = 0; i < 20; i++) {
            t += 120L;
            invDeg = est.step(t, true);
        }
        checkNear(invDeg, 0.0, 0.4, "silence decays smoothly to 0");
    }

    private static void testUvcRoadMotionEvidence() {
        int w = 640, h = 480;
        int sz = w * h * 3 / 2;
        ByteBuffer f1 = ByteBuffer.allocateDirect(sz);
        ByteBuffer f2 = ByteBuffer.allocateDirect(sz);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                byte v1 = (byte) ((x * 3 + y * 5) & 0xFF);
                byte v2 = (byte) (((x + 24) * 3 + (y + 12) * 5) & 0xFF);
                f1.put(y * w + x, v1);
                f2.put(y * w + x, v2);
            }
        }
        f1.position(0).limit(sz);
        f2.position(0).limit(sz);

        byte[] prev = new byte[UvcFrameSignalEvidence.ROAD_MOTION_GRID_SIZE];
        byte[] curr = new byte[UvcFrameSignalEvidence.ROAD_MOTION_GRID_SIZE];

        Float s0 = UvcFrameSignalEvidence.computeRoadMotionScore(f1, w, h, prev, curr);
        check(s0 != null && s0 >= 0f, "first sample returns non-null");
        check(f1.position() == 0 && f1.limit() == sz, "ByteBuffer position/limit preserved");
        System.arraycopy(curr, 0, prev, 0, curr.length);

        Float same = UvcFrameSignalEvidence.computeRoadMotionScore(f1, w, h, prev, curr);
        check(same != null && same < 0.01f, "identical frame has ~0 motion: " + same);

        Float moved = UvcFrameSignalEvidence.computeRoadMotionScore(f2, w, h, prev, curr);
        check(moved != null && moved > 5.0f, "shifted textured road frame produces strong motion score: " + moved);

        // Null/undersized buffer safe
        check(UvcFrameSignalEvidence.computeRoadMotionScore(null, w, h, prev, curr) == null, "null buffer returns null");
        check(UvcFrameSignalEvidence.computeRoadMotionScore(ByteBuffer.allocate(100), w, h, prev, curr) == null, "tiny buffer returns null");

        // GuideMotionHub frame size inference fallback
        GuideMotionHub.resetAll();
        GuideMotionHub.onUvcFrame(f1);
        GuideMotionHub.onUvcFrame(f2);
    }

    public static void main(String[] args) {
        testGeometryInvariants();
        testEstimatorVibrationGatingAndDecay();
        testUvcRoadMotionEvidence();
        System.out.println("ALL_GUIDE_ENGINE_UNIT_TESTS_PASSED");
    }
}
