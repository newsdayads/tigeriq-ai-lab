package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

/** Device-local onboarding state. No credentials or provider content are stored here. */
public final class SetupStateStore {
    private static final String PREFS = "tigeriq-phone-first-setup-v1";
    private static final String KEY_GEMINI_PENDING = "geminiPending";
    private static final String KEY_GEMINI_OPENED_AT = "geminiOpenedAt";
    private static final String KEY_GEMINI_CONFIRMED = "geminiConfirmed";
    private static final String KEY_COMPLETED = "completed";
    private static final String KEY_COMPLETED_AT = "completedAt";

    private SetupStateStore() {}

    public static void markGeminiLaunch(Context context) {
        prefs(context).edit()
            .putBoolean(KEY_GEMINI_PENDING, true)
            .putLong(KEY_GEMINI_OPENED_AT, System.currentTimeMillis())
            .apply();
    }

    /**
     * Called from the wizard when it resumes after launching Gemini. Opening the real package
     * successfully and returning to TigerIQ is sufficient for setup; login readiness is then
     * verified conservatively by the task adapter when work is actually submitted.
     */
    public static boolean confirmGeminiReturn(Context context) {
        SharedPreferences p = prefs(context);
        if (!p.getBoolean(KEY_GEMINI_PENDING, false)) return false;
        long openedAt = p.getLong(KEY_GEMINI_OPENED_AT, 0L);
        if (openedAt <= 0L || System.currentTimeMillis() - openedAt < 350L) return false;
        p.edit()
            .putBoolean(KEY_GEMINI_PENDING, false)
            .putBoolean(KEY_GEMINI_CONFIRMED, true)
            .apply();
        return true;
    }

    public static boolean geminiConfirmed(Context context) {
        return prefs(context).getBoolean(KEY_GEMINI_CONFIRMED, false);
    }

    public static void clearGeminiConfirmation(Context context) {
        prefs(context).edit()
            .putBoolean(KEY_GEMINI_PENDING, false)
            .putBoolean(KEY_GEMINI_CONFIRMED, false)
            .remove(KEY_GEMINI_OPENED_AT)
            .apply();
    }

    public static void markCompleted(Context context) {
        prefs(context).edit()
            .putBoolean(KEY_COMPLETED, true)
            .putLong(KEY_COMPLETED_AT, System.currentTimeMillis())
            .apply();
    }

    public static boolean completed(Context context) {
        return prefs(context).getBoolean(KEY_COMPLETED, false);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
