import com.tigeriq.camera.RemoteKeyShortcutEngine;
import com.tigeriq.camera.RemoteKeyShortcutEngine.Action;
import java.util.concurrent.atomic.AtomicInteger;

public class RemoteKeyShortcutUnitTest {
    private static void check(boolean cond, String msg) {
        if (!cond) {
            throw new AssertionError("FAIL: " + msg);
        }
    }

    private static void testShortPressReplaysAudioAndNeverTogglesCamera() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP, 800L);

        long t = 10_000L;
        // User taps VOL+ for 180ms (< 800ms hold threshold) -> press is held pending, then released triggers audio passthrough
        Action d = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP, 0, t);
        check(d == Action.CONSUME_PENDING_HOLD, "short press down must consume pending hold");
        check(engine.isHoldPending(), "hold should be pending after ACTION_DOWN");

        // Timeout check before 800ms must NOT fire
        check(engine.onHoldTimeout(t + 180L) == Action.CONSUME_ONLY, "no timeout before threshold");

        Action u = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP, 0, t + 180L);
        check(u == Action.REPLAY_SHORT_PRESS, "release before holdMs must replay short press audio");
        check(!engine.isHoldPending(), "hold cleared after release");
    }

    private static void testHoldUnder2sTriggersCameraExactlyOnce() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 800L);

        long t = 20_000L;
        Action d = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 0, t);
        check(d == Action.CONSUME_PENDING_HOLD, "down enters hold pending");

        // OS repeats ACTION_DOWN (repeatCount > 0) at 450ms -> still wait without re-starting timer
        Action r1 = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 1, t + 450L);
        check(r1 == Action.CONSUME_ONLY, "repeat before threshold stays consumed");

        // Timer fires cleanly at 800ms (< 2000ms) -> CAMERA TOGGLE ONCE!
        Action timeout = engine.onHoldTimeout(t + 800L);
        check(timeout == Action.TRIGGER_CAMERA, "timeout at 800ms (< 2s) must trigger camera");
        check(!engine.isHoldPending(), "pending cleared once triggered");

        // Duplicate timeout call never double-triggers
        check(engine.onHoldTimeout(t + 1200L) == Action.CONSUME_ONLY, "duplicate timeout must not retrigger");

        // Subsequent repeat at 1300ms and final ACTION_UP at 1400ms must NOT retrigger camera or replay audio
        Action r2 = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 5, t + 1300L);
        check(r2 == Action.CONSUME_ONLY, "post-trigger repeat consumed silently");
        Action u = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 0, t + 1400L);
        check(u == Action.CONSUME_ONLY, "post-trigger release must not replay short press");
    }

    private static void testReleaseFallbackBetweenHoldThresholdAnd2sTriggersOnce() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 700L);

        long t = 30_000L;
        Action d = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 0, t);
        check(d == Action.CONSUME_PENDING_HOLD, "voice down pending hold");

        // Suppose timer runnable didn't beat release at 950ms (< 2000ms) -> UP still triggers camera cleanly once
        Action u = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 0, t + 950L);
        check(u == Action.TRIGGER_CAMERA, "release in [holdMs, 2000ms) triggers camera if timer hasn't run");
    }

    private static void testThresholdClampedStrictlyBelow2SecondsAndZeroModeWorks() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 3500L);
        check(engine.getHoldThresholdMs() < 2000L, "hold threshold must always clamp < 2000ms: " + engine.getHoldThresholdMs());
        check(engine.getHoldThresholdMs() == RemoteKeyShortcutEngine.MAX_HOLD_MS, "clamped to MAX_HOLD_MS");

        // Instant mode (0ms) for a dedicated Voice/Camera button triggers on DOWN and consumes UP
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 0L);
        Action d = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 0, 40_000L);
        check(d == Action.TRIGGER_CAMERA, "0ms instant mode triggers camera on ACTION_DOWN");
        Action u = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 0, 40_120L);
        check(u == Action.CONSUME_ONLY, "0ms UP consumed without double-trigger or voice dialog");
    }

    private static void testOtherKeysAndDisabledStatePassThrough() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 800L);

        // Other 4 buttons on BT remote must pass straight through untouched
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP, 0, 50_000L) == Action.PASS_THROUGH,
            "non-target VOL+ down passes through");
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP, 0, 50_100L) == Action.PASS_THROUGH,
            "non-target VOL+ up passes through");

        // Disabled engine passes even target key through
        engine.configure(false, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 800L);
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 0, 51_000L) == Action.PASS_THROUGH,
            "disabled shortcut passes through");
    }

    private static void testSyntheticReplayBypassPreventsFeedbackLoop() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 800L);

        long t = 60_000L;
        engine.markSyntheticPassthrough(RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, t);
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t + 10L) == Action.PASS_THROUGH,
            "synthetic replayed DOWN must pass through");
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t + 20L) == Action.PASS_THROUGH,
            "synthetic replayed UP must pass through");

        // Subsequent real user press triggers normal interception again
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t + 500L) == Action.CONSUME_PENDING_HOLD,
            "subsequent real press intercepts normally");
    }

    private static void testLearnModeCapturesSafeKeyAndIgnoresSystemNavKeys() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(false, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, 800L);
        AtomicInteger learned = new AtomicInteger(-1);
        engine.startLearnMode(learned::set);

        // Unsafe Home/Back/Power keys must NOT be captured
        Action home = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_HOME, 0, 70_000L);
        check(home == Action.PASS_THROUGH && learned.get() == -1, "HOME must not be captured in learn mode");

        // Steering-wheel Next button IS captured even if shortcut was disabled before
        Action capDown = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 0, 70_100L);
        check(capDown == Action.LEARN_CAPTURED, "learn mode captures MEDIA_NEXT down");
        check(learned.get() == RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, "callback received MEDIA_NEXT");

        // Corresponding UP is consumed cleanly without triggering camera or short press
        Action capUp = engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, 0, 70_220L);
        check(capUp == Action.CONSUME_ONLY, "learn UP consumed cleanly");
        check(!engine.isLearnModeActive(), "learn mode exits after single capture");
    }

    private static void testQuickTapFollowedImmediatelyByHoldUnder2sWorks() {
        RemoteKeyShortcutEngine engine = new RemoteKeyShortcutEngine();
        engine.configure(true, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 700L);

        // Quick tap (150ms) replays audio
        long t = 80_000L;
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t) == Action.CONSUME_PENDING_HOLD,
            "first tap enters pending hold");
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t + 150L) == Action.REPLAY_SHORT_PRESS,
            "quick release replays music play/pause");

        // Immediately within 150ms, user holds again for 700ms (< 2s) -> must NOT be dropped
        long t2 = t + 300L;
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_DOWN, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t2) == Action.CONSUME_PENDING_HOLD,
            "immediate second press intercepts cleanly");
        check(engine.onHoldTimeout(t2 + 700L) == Action.TRIGGER_CAMERA,
            "holding >= 700ms triggers Camera Popup");
        check(engine.onKeyEvent(RemoteKeyShortcutEngine.ACTION_UP, RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, 0, t2 + 900L) == Action.CONSUME_ONLY,
            "release after trigger does not double-toggle");
    }

    private static void testFormatKeyNamesReadable() {
        check(RemoteKeyShortcutEngine.DEFAULT_HOLD_MS == 700L && RemoteKeyShortcutEngine.DEFAULT_HOLD_MS < 2000L, "default hold 700ms < 2s");
        check(RemoteKeyShortcutEngine.formatKeyName(RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP).contains("VOL+"), "VOL+ label");
        check(RemoteKeyShortcutEngine.formatKeyName(RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE).contains("Play"), "Play/Pause label");
        check(RemoteKeyShortcutEngine.formatKeyName(RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST).contains("Voice"), "Voice label");
        check(RemoteKeyShortcutEngine.formatKeyName(RemoteKeyShortcutEngine.KEYCODE_CALL).contains("Call"), "Call label");
        check(RemoteKeyShortcutEngine.formatKeyName(RemoteKeyShortcutEngine.KEYCODE_SEARCH).contains("Search"), "Search label");
    }

    public static void main(String[] args) {
        testShortPressReplaysAudioAndNeverTogglesCamera();
        testHoldUnder2sTriggersCameraExactlyOnce();
        testReleaseFallbackBetweenHoldThresholdAnd2sTriggersOnce();
        testThresholdClampedStrictlyBelow2SecondsAndZeroModeWorks();
        testOtherKeysAndDisabledStatePassThrough();
        testSyntheticReplayBypassPreventsFeedbackLoop();
        testLearnModeCapturesSafeKeyAndIgnoresSystemNavKeys();
        testQuickTapFollowedImmediatelyByHoldUnder2sWorks();
        testFormatKeyNamesReadable();
        System.out.println("ALL_REMOTE_KEY_SHORTCUT_TESTS_PASSED");
    }
}
