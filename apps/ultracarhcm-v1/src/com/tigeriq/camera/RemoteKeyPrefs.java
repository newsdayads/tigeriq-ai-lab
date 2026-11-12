package com.tigeriq.camera;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Persists Bluetooth remote camera-popup shortcut preferences and last-key diagnostics.
 */
public final class RemoteKeyPrefs {
    public static final String PREFS_NAME = "tigeriq_remote_shortcut";

    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_CODE = "key_code";
    private static final String KEY_HOLD_MS = "hold_ms";
    private static final String KEY_PENDING_TOGGLE = "pending_remote_toggle";
    private static final String KEY_LAST_CODE = "last_key_code";
    private static final String KEY_LAST_DESC = "last_key_desc";
    private static final String KEY_LAST_TS = "last_key_ts";

    public static final class Preset {
        public final int keyCode;
        public final String shortLabel;

        public Preset(int keyCode, String shortLabel) {
            this.keyCode = keyCode;
            this.shortLabel = shortLabel;
        }
    }

    public static final Preset[] BUTTON_PRESETS = new Preset[] {
        new Preset(RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST, "🎙 Voice (Trái)"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_MEDIA_PLAY_PAUSE, "►‖ Play / Giữa"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_MEDIA_NEXT, "►| Next (Phải)"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_VOLUME_UP, "🔊 VOL+ (Trên)"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_VOLUME_DOWN, "🔉 VOL- (Dưới)"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_MEDIA_PREVIOUS, "|◄ Prev"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_ASSIST, "🎙 Assist"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_HEADSETHOOK, "🎧 Hook"),
        new Preset(RemoteKeyShortcutEngine.KEYCODE_CALL, "📞 Call / Voice")
    };

    public static final long[] HOLD_PRESETS_MS = new long[] {
        500L,
        700L,
        1000L,
        1300L,
        1600L,
        0L
    };

    private RemoteKeyPrefs() {}

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static boolean isEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    public static int getKeyCode(Context ctx) {
        return prefs(ctx).getInt(KEY_CODE, RemoteKeyShortcutEngine.KEYCODE_VOICE_ASSIST);
    }

    public static void setKeyCode(Context ctx, int keyCode) {
        prefs(ctx).edit().putInt(KEY_CODE, keyCode).apply();
    }

    public static long getHoldMs(Context ctx) {
        long val = prefs(ctx).getLong(KEY_HOLD_MS, RemoteKeyShortcutEngine.DEFAULT_HOLD_MS);
        return RemoteKeyShortcutEngine.clampHoldMs(val);
    }

    public static void setHoldMs(Context ctx, long holdMs) {
        prefs(ctx).edit().putLong(KEY_HOLD_MS, RemoteKeyShortcutEngine.clampHoldMs(holdMs)).apply();
    }

    public static void setPendingToggle(Context ctx, boolean pending) {
        prefs(ctx).edit().putBoolean(KEY_PENDING_TOGGLE, pending).commit();
    }

    public static boolean consumePendingToggle(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(KEY_PENDING_TOGGLE, false)) {
            return false;
        }
        p.edit().putBoolean(KEY_PENDING_TOGGLE, false).apply();
        return true;
    }

    public static void recordLastKey(Context ctx, int keyCode, String deviceName, long tsMs) {
        String safeDev = (deviceName == null || deviceName.trim().isEmpty()) ? "Bluetooth / HID" : deviceName.trim();
        String desc = RemoteKeyShortcutEngine.formatKeyName(keyCode) + " [" + safeDev + "]";
        prefs(ctx).edit()
            .putInt(KEY_LAST_CODE, keyCode)
            .putString(KEY_LAST_DESC, desc)
            .putLong(KEY_LAST_TS, tsMs)
            .apply();
    }

    public static int getLastObservedKeyCode(Context ctx) {
        return prefs(ctx).getInt(KEY_LAST_CODE, RemoteKeyShortcutEngine.KEYCODE_UNKNOWN);
    }

    public static String getLastKeySummary(Context ctx) {
        SharedPreferences p = prefs(ctx);
        int code = p.getInt(KEY_LAST_CODE, RemoteKeyShortcutEngine.KEYCODE_UNKNOWN);
        if (code <= 0) {
            return "Chưa ghi nhận phím nào — bấm nút trên Remote để kiểm tra.";
        }
        String desc = p.getString(KEY_LAST_DESC, "");
        return "Phím vừa nhận gần nhất: " + desc + " (code=" + code + ")";
    }

    public static String formatHoldLabel(long ms) {
        long clamped = RemoteKeyShortcutEngine.clampHoldMs(ms);
        if (clamped <= 0L) {
            return "Bấm 1 lần (0s)";
        }
        if (clamped == 700L) {
            return "0.7s (Khuyên dùng)";
        }
        return String.format(java.util.Locale.US, "%.1fs (< 2s)", clamped / 1000.0);
    }
}
