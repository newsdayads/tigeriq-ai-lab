package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

public final class LocalTaskStore {
    public static final String PREFS = "tigeriq-local-task";
    public static final String IDLE = "IDLE";
    public static final String QUEUED = "QUEUED";
    public static final String INPUT_SET = "INPUT_SET";
    public static final String SUBMITTED = "SUBMITTED";
    public static final String RESULT_READY = "RESULT_READY";
    public static final String FAILED = "FAILED";

    private static final String KEY_PROMPT = "prompt";
    private static final String KEY_RESULT = "result";
    private static final String KEY_STATE = "state";
    private static final String KEY_ERROR = "error";
    private static final String KEY_STARTED_AT = "startedAt";
    private static final String KEY_UPDATED_AT = "updatedAt";

    private LocalTaskStore() {}

    public static void queue(Context context, String prompt) {
        long now = System.currentTimeMillis();
        prefs(context).edit()
            .putString(KEY_PROMPT, prompt == null ? "" : prompt.trim())
            .putString(KEY_RESULT, "")
            .putString(KEY_ERROR, "")
            .putString(KEY_STATE, QUEUED)
            .putLong(KEY_STARTED_AT, now)
            .putLong(KEY_UPDATED_AT, now)
            .apply();
    }

    public static void updateState(Context context, String state) {
        prefs(context).edit()
            .putString(KEY_STATE, state)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .apply();
    }

    public static void complete(Context context, String result) {
        prefs(context).edit()
            .putString(KEY_RESULT, result == null ? "" : result.trim())
            .putString(KEY_ERROR, "")
            .putString(KEY_STATE, RESULT_READY)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .apply();
    }

    public static void fail(Context context, String error) {
        prefs(context).edit()
            .putString(KEY_ERROR, error == null ? "UNKNOWN" : error)
            .putString(KEY_STATE, FAILED)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .apply();
    }

    public static Snapshot load(Context context) {
        SharedPreferences p = prefs(context);
        return new Snapshot(
            p.getString(KEY_PROMPT, ""),
            p.getString(KEY_RESULT, ""),
            p.getString(KEY_STATE, IDLE),
            p.getString(KEY_ERROR, ""),
            p.getLong(KEY_STARTED_AT, 0L),
            p.getLong(KEY_UPDATED_AT, 0L)
        );
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static final class Snapshot {
        public final String prompt;
        public final String result;
        public final String state;
        public final String error;
        public final long startedAt;
        public final long updatedAt;

        Snapshot(String prompt, String result, String state, String error, long startedAt, long updatedAt) {
            this.prompt = prompt == null ? "" : prompt;
            this.result = result == null ? "" : result;
            this.state = state == null ? IDLE : state;
            this.error = error == null ? "" : error;
            this.startedAt = startedAt;
            this.updatedAt = updatedAt;
        }

        public boolean active() {
            return QUEUED.equals(state) || INPUT_SET.equals(state) || SUBMITTED.equals(state);
        }
    }
}
