package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

/** Owner-controlled durable pause gate for mobile worker automation. */
public final class WorkerRuntimeControl {
    private static final String PREFS = "tigeriq-worker-control";
    private static final String KEY_PAUSED = "paused";
    private static final String KEY_CHANGED_AT = "changedAt";

    private WorkerRuntimeControl() {}

    public static boolean isPaused(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_PAUSED, false);
    }

    public static void pause(Context context) {
        write(context, true);
    }

    public static void resume(Context context) {
        write(context, false);
    }

    private static void write(Context context, boolean paused) {
        SharedPreferences.Editor edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_PAUSED, paused)
            .putLong(KEY_CHANGED_AT, System.currentTimeMillis());
        edit.apply();
    }
}