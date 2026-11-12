package com.tigeriq.camera;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Toast;

/**
 * Global key-event accessibility service for Bluetooth steering-wheel remotes.
 * Distinguishes short presses (replayed to audio/system normally) from intentional
 * holds (< 2s) that call TigerIQBridge.toggleCamera() — identically to clicking
 * the floating Camera Popup [R] icon — without ever hiding UltraCar.
 */
public class RemoteKeyAccessibilityService extends AccessibilityService {
    private static final String TAG = "RemoteKeySvc";
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static final RemoteKeyShortcutEngine ENGINE = new RemoteKeyShortcutEngine();

    public static volatile RemoteKeyAccessibilityService sInstance = null;

    private static Runnable pendingHoldRunnable = null;
    private static volatile KeyDiagnosticListener diagnosticListener = null;

    public interface KeyDiagnosticListener {
        void onKeyObserved(int keyCode, String deviceName, boolean learned);
    }

    public static void setDiagnosticListener(KeyDiagnosticListener listener) {
        diagnosticListener = listener;
    }

    public static void syncFromPrefs(Context ctx) {
        if (ctx == null) return;
        cancelPendingRunnable();
        boolean en = RemoteKeyPrefs.isEnabled(ctx);
        int code = RemoteKeyPrefs.getKeyCode(ctx);
        long holdMs = RemoteKeyPrefs.getHoldMs(ctx);
        ENGINE.configure(en, code, holdMs);
    }

    public static void startLearn(Context ctx, final RemoteKeyShortcutEngine.LearnCallback cb) {
        cancelPendingRunnable();
        ENGINE.startLearnMode(new RemoteKeyShortcutEngine.LearnCallback() {
            @Override
            public void onKeyCaptured(final int keyCode) {
                MAIN_HANDLER.post(new Runnable() {
                    @Override
                    public void run() {
                        if (cb != null) cb.onKeyCaptured(keyCode);
                    }
                });
            }
        });
    }

    public static void stopLearn(Context ctx) {
        ENGINE.stopLearnMode();
        syncFromPrefs(ctx);
    }

    public static void onHostActivityResumed(final Activity activity) {
        if (activity == null) return;
        try {
            tryAutoEnableIfPermitted(activity);
            syncFromPrefs(activity);
            RemoteShortcutOverlayDialog.attachBadgeToActivity(activity);
            if (RemoteKeyPrefs.consumePendingToggle(activity)) {
                MAIN_HANDLER.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        invokeToggleCameraPopup(activity);
                    }
                }, 350L);
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        sInstance = this;
        try {
            AccessibilityServiceInfo info = getServiceInfo();
            if (info == null) {
                info = new AccessibilityServiceInfo();
            }
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(info);
        } catch (Throwable t) {
            Log.w(TAG, "Failed updating service info flags", t);
        }
        syncFromPrefs(this);
        Log.i(TAG, "Connected: keyCode=" + ENGINE.getTargetKeyCode() + " holdMs=" + ENGINE.getHoldThresholdMs());
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Key events only; no window-content scraping.
    }

    @Override
    public void onInterrupt() {
        cancelPendingRunnable();
        ENGINE.reset();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        cancelPendingRunnable();
        ENGINE.reset();
        if (sInstance == this) {
            sInstance = null;
        }
        return super.onUnbind(intent);
    }

    @Override
    protected boolean onKeyEvent(final KeyEvent event) {
        if (event == null) {
            return false;
        }
        final int action = event.getAction();
        final int keyCode = event.getKeyCode();
        final int repeat = event.getRepeatCount();
        final long nowMs = SystemClock.uptimeMillis();

        if (event.isCanceled()) {
            cancelPendingRunnable();
            ENGINE.onKeyEvent(KeyEvent.ACTION_UP, keyCode, 0, nowMs);
            return false;
        }

        final String devName = extractDeviceName(event);
        if (action == KeyEvent.ACTION_DOWN && repeat == 0 && (diagnosticListener != null || keyCode == ENGINE.getTargetKeyCode())) {
            RemoteKeyPrefs.recordLastKey(this, keyCode, devName, System.currentTimeMillis());
        }

        final KeyDiagnosticListener diag = diagnosticListener;
        if (diag != null && action == KeyEvent.ACTION_DOWN && repeat == 0) {
            final boolean wasLearning = ENGINE.isLearnModeActive();
            MAIN_HANDLER.post(new Runnable() {
                @Override
                public void run() {
                    diag.onKeyObserved(keyCode, devName, wasLearning && RemoteKeyShortcutEngine.isSafeMappableKey(keyCode));
                }
            });
        }

        int mappedAction;
        if (action == KeyEvent.ACTION_DOWN) {
            mappedAction = RemoteKeyShortcutEngine.ACTION_DOWN;
        } else if (action == KeyEvent.ACTION_UP) {
            mappedAction = RemoteKeyShortcutEngine.ACTION_UP;
        } else {
            return false;
        }

        RemoteKeyShortcutEngine.Action result = ENGINE.onKeyEvent(mappedAction, keyCode, repeat, nowMs);
        switch (result) {
            case CONSUME_PENDING_HOLD:
                scheduleHoldTimeout(ENGINE.getActivePressId(), ENGINE.getHoldThresholdMs());
                return true;
            case TRIGGER_CAMERA:
                cancelPendingRunnable();
                triggerCameraFromWorker();
                return true;
            case REPLAY_SHORT_PRESS:
                cancelPendingRunnable();
                replayShortPressAsync(keyCode);
                return true;
            case LEARN_CAPTURED:
            case CONSUME_ONLY:
                if (mappedAction == RemoteKeyShortcutEngine.ACTION_UP) {
                    cancelPendingRunnable();
                }
                return true;
            case PASS_THROUGH:
            default:
                return false;
        }
    }

    private void scheduleHoldTimeout(final long pressId, long delayMs) {
        cancelPendingRunnable();
        final Runnable r = new Runnable() {
            @Override
            public void run() {
                synchronized (RemoteKeyAccessibilityService.class) {
                    if (pendingHoldRunnable != this) {
                        return;
                    }
                    pendingHoldRunnable = null;
                }
                if (ENGINE.onHoldTimeoutForPress(pressId, SystemClock.uptimeMillis()) == RemoteKeyShortcutEngine.Action.TRIGGER_CAMERA) {
                    invokeToggleCameraPopup(RemoteKeyAccessibilityService.this);
                }
            }
        };
        synchronized (RemoteKeyAccessibilityService.class) {
            pendingHoldRunnable = r;
        }
        MAIN_HANDLER.postDelayed(r, delayMs);
    }

    private static synchronized void cancelPendingRunnable() {
        if (pendingHoldRunnable != null) {
            MAIN_HANDLER.removeCallbacks(pendingHoldRunnable);
            pendingHoldRunnable = null;
        }
    }

    private void triggerCameraFromWorker() {
        MAIN_HANDLER.post(new Runnable() {
            @Override
            public void run() {
                invokeToggleCameraPopup(RemoteKeyAccessibilityService.this);
            }
        });
    }

    private void replayShortPressAsync(final int keyCode) {
        MAIN_HANDLER.post(new Runnable() {
            @Override
            public void run() {
                replayShortPress(RemoteKeyAccessibilityService.this, keyCode);
            }
        });
    }

    /**
     * Exact behavioral equivalent to clicking FloatingCameraService's [R] Camera Popup icon.
     * Uses TigerIQBridge.toggleCamera() when MainActivity is alive; never launches extra Activities
     * unless UltraCar MainActivity itself is null (not running yet).
     */
    public static void invokeToggleCameraPopup(final Context ctx) {
        if (ctx == null) return;
        try {
            Class<?> bridgeCls = Class.forName("com.ultracar.dexsplit.ui.TigerIQBridge");
            Object act = bridgeCls.getField("sInstance").get(null);
            boolean wasEnabled = bridgeCls.getField("sCameraEnabled").getBoolean(null);
            if (act != null) {
                bridgeCls.getMethod("toggleCamera").invoke(null);
                Toast.makeText(
                    ctx.getApplicationContext(),
                    wasEnabled ? "Camera Popup: TẮT" : "Camera Popup: BẬT",
                    Toast.LENGTH_SHORT
                ).show();
            } else {
                RemoteKeyPrefs.setPendingToggle(ctx, true);
                Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    ctx.startActivity(launch);
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error invoking TigerIQBridge.toggleCamera", t);
        }
    }

    private static void replayShortPress(Context ctx, int keyCode) {
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                if (am != null) {
                    am.adjustSuggestedStreamVolume(
                        AudioManager.ADJUST_RAISE,
                        AudioManager.USE_DEFAULT_STREAM_TYPE,
                        AudioManager.FLAG_SHOW_UI
                    );
                }
                return;
            }
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                if (am != null) {
                    am.adjustSuggestedStreamVolume(
                        AudioManager.ADJUST_LOWER,
                        AudioManager.USE_DEFAULT_STREAM_TYPE,
                        AudioManager.FLAG_SHOW_UI
                    );
                }
                return;
            }
            if (keyCode == KeyEvent.KEYCODE_VOLUME_MUTE || keyCode == KeyEvent.KEYCODE_MUTE) {
                if (am != null) {
                    am.adjustSuggestedStreamVolume(
                        AudioManager.ADJUST_TOGGLE_MUTE,
                        AudioManager.USE_DEFAULT_STREAM_TYPE,
                        AudioManager.FLAG_SHOW_UI
                    );
                }
                return;
            }
            if (KeyEvent.isMediaSessionKey(keyCode)
                    || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                    || keyCode == KeyEvent.KEYCODE_MEDIA_NEXT
                    || keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS
                    || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY
                    || keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE
                    || keyCode == KeyEvent.KEYCODE_MEDIA_STOP
                    || keyCode == KeyEvent.KEYCODE_HEADSETHOOK) {
                if (am != null) {
                    // Dispatch straight to MediaSessionManager without mutating ENGINE synthetic guard.
                    long t = SystemClock.uptimeMillis();
                    am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, keyCode, 0));
                    am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, keyCode, 0));
                }
                return;
            }
            if (keyCode == KeyEvent.KEYCODE_VOICE_ASSIST
                    || keyCode == KeyEvent.KEYCODE_ASSIST
                    || keyCode == KeyEvent.KEYCODE_SEARCH) {
                Intent voice = new Intent(Intent.ACTION_VOICE_COMMAND);
                voice.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    ctx.startActivity(voice);
                } catch (Throwable ignored) {
                    Intent assist = new Intent(Intent.ACTION_ASSIST);
                    assist.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        ctx.startActivity(assist);
                    } catch (Throwable ignored2) {
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "replayShortPress failed for keyCode=" + keyCode, t);
        }
    }

    private static String extractDeviceName(KeyEvent event) {
        try {
            InputDevice dev = event.getDevice();
            if (dev != null && dev.getName() != null) {
                return dev.getName();
            }
        } catch (Throwable ignored) {
        }
        return "Bluetooth / Hệ thống";
    }

    public static boolean isAccessibilityEnabled(Context ctx) {
        if (sInstance != null) {
            return true;
        }
        if (ctx == null) {
            return false;
        }
        try {
            String target = new ComponentName(ctx, RemoteKeyAccessibilityService.class).flattenToString();
            String shortTarget = new ComponentName(ctx, RemoteKeyAccessibilityService.class).flattenToShortString();
            String enabled = Settings.Secure.getString(
                ctx.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            if (enabled == null) {
                return false;
            }
            TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
            splitter.setString(enabled);
            while (splitter.hasNext()) {
                String comp = splitter.next();
                if (comp.equalsIgnoreCase(target) || comp.equalsIgnoreCase(shortTarget)) {
                    return true;
                }
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    public static boolean tryAutoEnableIfPermitted(Context ctx) {
        if (ctx == null) return false;
        if (isAccessibilityEnabled(ctx)) return true;
        try {
            String full = new ComponentName(ctx, RemoteKeyAccessibilityService.class).flattenToString();
            String cur = Settings.Secure.getString(
                ctx.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            String next = (cur == null || cur.trim().isEmpty()) ? full : (cur + ":" + full);
            Settings.Secure.putString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, next);
            Settings.Secure.putInt(ctx.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            return isAccessibilityEnabled(ctx);
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static void openAccessibilitySettings(Context ctx) {
        if (ctx == null) return;
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Throwable ignored) {
        }
    }
}
