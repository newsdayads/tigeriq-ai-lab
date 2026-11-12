package com.tigeriq.camera;

/**
 * Pure-Java deterministic state machine for Bluetooth steering-wheel remote shortcuts.
 * Differentiates quick audio presses (< holdThresholdMs) from intentional holds
 * (>= holdThresholdMs, strictly < 2000ms) that toggle UltraCar Camera Popup without
 * interfering with unrelated remote keys.
 */
public final class RemoteKeyShortcutEngine {
    public static final int ACTION_DOWN = 0;
    public static final int ACTION_UP = 1;
    public static final int ACTION_MULTIPLE = 2;

    public static final int KEYCODE_UNKNOWN = 0;
    public static final int KEYCODE_HOME = 3;
    public static final int KEYCODE_BACK = 4;
    public static final int KEYCODE_CALL = 5;
    public static final int KEYCODE_DPAD_CENTER = 23;
    public static final int KEYCODE_VOLUME_UP = 24;
    public static final int KEYCODE_VOLUME_DOWN = 25;
    public static final int KEYCODE_POWER = 26;
    public static final int KEYCODE_CAMERA = 27;
    public static final int KEYCODE_ENTER = 66;
    public static final int KEYCODE_HEADSETHOOK = 79;
    public static final int KEYCODE_SEARCH = 84;
    public static final int KEYCODE_MEDIA_PLAY_PAUSE = 85;
    public static final int KEYCODE_MEDIA_STOP = 86;
    public static final int KEYCODE_MEDIA_NEXT = 87;
    public static final int KEYCODE_MEDIA_PREVIOUS = 88;
    public static final int KEYCODE_MEDIA_REWIND = 89;
    public static final int KEYCODE_MEDIA_FAST_FORWARD = 90;
    public static final int KEYCODE_MUTE = 91;
    public static final int KEYCODE_MEDIA_PLAY = 126;
    public static final int KEYCODE_MEDIA_PAUSE = 127;
    public static final int KEYCODE_VOLUME_MUTE = 164;
    public static final int KEYCODE_APP_SWITCH = 187;
    public static final int KEYCODE_ASSIST = 219;
    public static final int KEYCODE_VOICE_ASSIST = 231;

    public static final long DEFAULT_HOLD_MS = 700L;
    public static final long MIN_HOLD_MS = 0L;
    public static final long MAX_HOLD_MS = 1900L;
    public static final long HARD_UPPER_BOUND_MS = 2000L;
    private static final long SYNTHETIC_BYPASS_WINDOW_MS = 600L;

    public enum Action {
        PASS_THROUGH,
        CONSUME_PENDING_HOLD,
        CONSUME_ONLY,
        TRIGGER_CAMERA,
        REPLAY_SHORT_PRESS,
        LEARN_CAPTURED
    }

    public interface LearnCallback {
        void onKeyCaptured(int keyCode);
    }

    private boolean enabled = false;
    private int targetKeyCode = KEYCODE_VOICE_ASSIST;
    private long holdThresholdMs = DEFAULT_HOLD_MS;

    private boolean downActive = false;
    private long downTimeMs = 0L;
    private boolean holdTriggered = false;
    private long activePressId = 0L;

    private boolean learnMode = false;
    private LearnCallback learnCallback = null;
    private int capturingUpForKeyCode = KEYCODE_UNKNOWN;

    private int syntheticKeyCode = KEYCODE_UNKNOWN;
    private long syntheticExpiryMs = 0L;
    private int syntheticRemainingEvents = 0;

    public synchronized void configure(boolean enabled, int targetKeyCode, long holdThresholdMs) {
        this.enabled = enabled;
        this.targetKeyCode = targetKeyCode;
        this.holdThresholdMs = clampHoldMs(holdThresholdMs);
        clearPendingPress();
    }

    public synchronized void reset() {
        clearPendingPress();
        learnMode = false;
        learnCallback = null;
        capturingUpForKeyCode = KEYCODE_UNKNOWN;
        syntheticKeyCode = KEYCODE_UNKNOWN;
        syntheticExpiryMs = 0L;
        syntheticRemainingEvents = 0;
    }

    public static long clampHoldMs(long ms) {
        if (ms < MIN_HOLD_MS) return MIN_HOLD_MS;
        if (ms > MAX_HOLD_MS) return MAX_HOLD_MS;
        return ms;
    }

    public synchronized boolean isEnabled() {
        return enabled;
    }

    public synchronized int getTargetKeyCode() {
        return targetKeyCode;
    }

    public synchronized long getHoldThresholdMs() {
        return holdThresholdMs;
    }

    public synchronized boolean isHoldPending() {
        return downActive && !holdTriggered;
    }

    public synchronized long getActivePressId() {
        return activePressId;
    }

    public synchronized void startLearnMode(LearnCallback callback) {
        clearPendingPress();
        this.learnMode = true;
        this.learnCallback = callback;
        this.capturingUpForKeyCode = KEYCODE_UNKNOWN;
    }

    public synchronized void stopLearnMode() {
        this.learnMode = false;
        this.learnCallback = null;
        this.capturingUpForKeyCode = KEYCODE_UNKNOWN;
    }

    public synchronized boolean isLearnModeActive() {
        return learnMode;
    }

    public synchronized void markSyntheticPassthrough(int keyCode, long nowMs) {
        this.syntheticKeyCode = keyCode;
        this.syntheticExpiryMs = nowMs + SYNTHETIC_BYPASS_WINDOW_MS;
        this.syntheticRemainingEvents = 2;
    }

    public static boolean isSafeMappableKey(int keyCode) {
        if (keyCode <= KEYCODE_UNKNOWN) return false;
        return keyCode != KEYCODE_HOME
                && keyCode != KEYCODE_BACK
                && keyCode != KEYCODE_POWER
                && keyCode != KEYCODE_APP_SWITCH;
    }

    public synchronized Action onKeyEvent(int action, int keyCode, int repeatCount, long nowMs) {
        if (syntheticRemainingEvents > 0 && keyCode == syntheticKeyCode && nowMs <= syntheticExpiryMs) {
            syntheticRemainingEvents--;
            if (syntheticRemainingEvents <= 0) {
                syntheticKeyCode = KEYCODE_UNKNOWN;
                syntheticExpiryMs = 0L;
            }
            return Action.PASS_THROUGH;
        }

        if (keyCode == capturingUpForKeyCode && action == ACTION_UP) {
            capturingUpForKeyCode = KEYCODE_UNKNOWN;
            return Action.CONSUME_ONLY;
        }

        if (learnMode) {
            if (!isSafeMappableKey(keyCode)) {
                return Action.PASS_THROUGH;
            }
            if (action == ACTION_DOWN && repeatCount == 0) {
                LearnCallback cb = this.learnCallback;
                this.learnMode = false;
                this.learnCallback = null;
                this.capturingUpForKeyCode = keyCode;
                clearPendingPress();
                if (cb != null) {
                    cb.onKeyCaptured(keyCode);
                }
                return Action.LEARN_CAPTURED;
            }
            return Action.CONSUME_ONLY;
        }

        if (!enabled || targetKeyCode <= KEYCODE_UNKNOWN || keyCode != targetKeyCode) {
            return Action.PASS_THROUGH;
        }

        if (action == ACTION_DOWN) {
            if (repeatCount == 0 && !downActive) {
                downActive = true;
                downTimeMs = nowMs;
                holdTriggered = false;
                activePressId++;
                if (holdThresholdMs <= 0L) {
                    holdTriggered = true;
                    return Action.TRIGGER_CAMERA;
                }
                return Action.CONSUME_PENDING_HOLD;
            }
            return Action.CONSUME_ONLY;
        }

        if (action == ACTION_UP) {
            if (!downActive) {
                return Action.CONSUME_ONLY;
            }
            boolean alreadyTriggered = holdTriggered;
            long heldMs = Math.max(0L, nowMs - downTimeMs);
            clearPendingPress();
            if (alreadyTriggered || holdThresholdMs <= 0L) {
                return Action.CONSUME_ONLY;
            }
            if (heldMs >= holdThresholdMs && heldMs < HARD_UPPER_BOUND_MS) {
                return Action.TRIGGER_CAMERA;
            }
            return Action.REPLAY_SHORT_PRESS;
        }

        return Action.CONSUME_ONLY;
    }

    public synchronized Action onHoldTimeout(long nowMs) {
        return onHoldTimeoutForPress(activePressId, nowMs);
    }

    public synchronized Action onHoldTimeoutForPress(long pressId, long nowMs) {
        if (!enabled || !downActive || holdTriggered || pressId != activePressId) {
            return Action.CONSUME_ONLY;
        }
        long elapsed = Math.max(0L, nowMs - downTimeMs);
        if (elapsed >= holdThresholdMs && elapsed < HARD_UPPER_BOUND_MS) {
            holdTriggered = true;
            return Action.TRIGGER_CAMERA;
        }
        return Action.CONSUME_ONLY;
    }

    private void clearPendingPress() {
        downActive = false;
        downTimeMs = 0L;
        holdTriggered = false;
    }

    public static String formatKeyName(int keyCode) {
        switch (keyCode) {
            case KEYCODE_VOLUME_UP:
                return "VOL+ (Tăng âm lượng)";
            case KEYCODE_VOLUME_DOWN:
                return "VOL- (Giảm âm lượng)";
            case KEYCODE_VOLUME_MUTE:
            case KEYCODE_MUTE:
                return "🔇 Mute (Tắt tiếng)";
            case KEYCODE_MEDIA_PLAY_PAUSE:
                return "►‖ (Play / Pause)";
            case KEYCODE_MEDIA_PLAY:
                return "► (Play)";
            case KEYCODE_MEDIA_PAUSE:
                return "‖ (Pause)";
            case KEYCODE_MEDIA_NEXT:
                return "►| (Next / Qua bài)";
            case KEYCODE_MEDIA_PREVIOUS:
                return "|◄ (Prev / Lùi bài)";
            case KEYCODE_MEDIA_FAST_FORWARD:
                return "►► (Tua nhanh)";
            case KEYCODE_MEDIA_REWIND:
                return "◄◄ (Tua lại)";
            case KEYCODE_MEDIA_STOP:
                return "■ (Stop)";
            case KEYCODE_VOICE_ASSIST:
                return "🎙 Voice (Trợ lý giọng nói)";
            case KEYCODE_ASSIST:
                return "🎙 Assist / Tìm kiếm giọng nói";
            case KEYCODE_SEARCH:
                return "🔍 Search / Voice";
            case KEYCODE_CALL:
                return "📞 Call / Nút nghe gọi";
            case KEYCODE_HEADSETHOOK:
                return "🎧 Headset Hook";
            case KEYCODE_CAMERA:
                return "📷 Nút Camera";
            case KEYCODE_ENTER:
                return "OK / Enter";
            case KEYCODE_DPAD_CENTER:
                return "Nút giữa (DPAD Center)";
            case KEYCODE_UNKNOWN:
                return "Chưa gán phím";
            default:
                return "Phím #" + keyCode;
        }
    }
}
