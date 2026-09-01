package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class LocalTaskStore {
    public static final String PREFS = "tigeriq-local-task";
    public static final String IDLE = "IDLE";
    public static final String QUEUED = "QUEUED";
    public static final String INPUT_SET = "INPUT_SET";
    public static final String SUBMITTED = "SUBMITTED";
    public static final String RESULT_READY = "RESULT_READY";
    public static final String FAILED = "FAILED";

    private static final int HISTORY_LIMIT = 12;
    private static final String KEY_PROMPT = "prompt";
    private static final String KEY_RESULT = "result";
    private static final String KEY_STATE = "state";
    private static final String KEY_ERROR = "error";
    private static final String KEY_STARTED_AT = "startedAt";
    private static final String KEY_UPDATED_AT = "updatedAt";
    private static final String KEY_FINISHED_AT = "finishedAt";
    private static final String KEY_BOUNDARY_CAPTURED = "boundaryCaptured";
    private static final String KEY_BASELINE_HASHES = "baselineHashes";
    private static final String KEY_BASELINE_MARKER_COUNT = "baselineMarkerCount";
    private static final String KEY_HISTORY_COUNT = "historyCount";

    private LocalTaskStore() {}

    public static void queue(Context context, String prompt) {
        SharedPreferences p = prefs(context);
        long now = System.currentTimeMillis();
        Snapshot previous = snapshot(p);
        if (previous.active()) {
            archiveRecord(p, new TaskRecord(
                previous.prompt,
                previous.result,
                FAILED,
                "SUPERSEDED",
                previous.startedAt,
                now
            ));
        }
        p.edit()
            .putString(KEY_PROMPT, prompt == null ? "" : prompt.trim())
            .putString(KEY_RESULT, "")
            .putString(KEY_ERROR, "")
            .putString(KEY_STATE, QUEUED)
            .putLong(KEY_STARTED_AT, now)
            .putLong(KEY_UPDATED_AT, now)
            .putLong(KEY_FINISHED_AT, 0L)
            .putBoolean(KEY_BOUNDARY_CAPTURED, false)
            .putStringSet(KEY_BASELINE_HASHES, new HashSet<>())
            .putInt(KEY_BASELINE_MARKER_COUNT, -1)
            .commit();
    }

    public static void updateState(Context context, String state) {
        prefs(context).edit()
            .putString(KEY_STATE, state)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .commit();
    }

    public static void markSubmitted(Context context, Set<String> baselineHashes, int baselineMarkerCount) {
        long now = System.currentTimeMillis();
        prefs(context).edit()
            .putString(KEY_STATE, SUBMITTED)
            .putLong(KEY_UPDATED_AT, now)
            .putBoolean(KEY_BOUNDARY_CAPTURED, true)
            .putStringSet(KEY_BASELINE_HASHES, baselineHashes == null ? new HashSet<>() : new HashSet<>(baselineHashes))
            .putInt(KEY_BASELINE_MARKER_COUNT, Math.max(0, baselineMarkerCount))
            .commit();
    }

    public static void complete(Context context, String result) {
        SharedPreferences p = prefs(context);
        Snapshot before = snapshot(p);
        if (!before.active()) return;
        long now = System.currentTimeMillis();
        p.edit()
            .putString(KEY_RESULT, result == null ? "" : result.trim())
            .putString(KEY_ERROR, "")
            .putString(KEY_STATE, RESULT_READY)
            .putLong(KEY_UPDATED_AT, now)
            .putLong(KEY_FINISHED_AT, now)
            .commit();
        archiveCurrent(p);
    }

    public static void fail(Context context, String error) {
        SharedPreferences p = prefs(context);
        Snapshot before = snapshot(p);
        if (!before.active()) return;
        long now = System.currentTimeMillis();
        p.edit()
            .putString(KEY_ERROR, error == null ? "UNKNOWN" : error)
            .putString(KEY_STATE, FAILED)
            .putLong(KEY_UPDATED_AT, now)
            .putLong(KEY_FINISHED_AT, now)
            .commit();
        archiveCurrent(p);
    }

    public static Snapshot load(Context context) {
        return snapshot(prefs(context));
    }

    public static List<TaskRecord> loadHistory(Context context) {
        SharedPreferences p = prefs(context);
        int count = Math.min(HISTORY_LIMIT, Math.max(0, p.getInt(KEY_HISTORY_COUNT, 0)));
        ArrayList<TaskRecord> records = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            records.add(new TaskRecord(
                p.getString(historyKey(i, "prompt"), ""),
                p.getString(historyKey(i, "result"), ""),
                p.getString(historyKey(i, "state"), FAILED),
                p.getString(historyKey(i, "error"), ""),
                p.getLong(historyKey(i, "startedAt"), 0L),
                p.getLong(historyKey(i, "finishedAt"), 0L)
            ));
        }
        return records;
    }

    private static Snapshot snapshot(SharedPreferences p) {
        Set<String> storedHashes = p.getStringSet(KEY_BASELINE_HASHES, new HashSet<>());
        return new Snapshot(
            p.getString(KEY_PROMPT, ""),
            p.getString(KEY_RESULT, ""),
            p.getString(KEY_STATE, IDLE),
            p.getString(KEY_ERROR, ""),
            p.getLong(KEY_STARTED_AT, 0L),
            p.getLong(KEY_UPDATED_AT, 0L),
            p.getLong(KEY_FINISHED_AT, 0L),
            p.getBoolean(KEY_BOUNDARY_CAPTURED, false),
            storedHashes == null ? new HashSet<>() : new HashSet<>(storedHashes),
            p.getInt(KEY_BASELINE_MARKER_COUNT, -1)
        );
    }

    private static void archiveCurrent(SharedPreferences p) {
        Snapshot current = snapshot(p);
        archiveRecord(p, new TaskRecord(
            current.prompt,
            current.result,
            current.state,
            current.error,
            current.startedAt,
            current.finishedAt > 0L ? current.finishedAt : current.updatedAt
        ));
    }

    private static void archiveRecord(SharedPreferences p, TaskRecord record) {
        int count = Math.min(HISTORY_LIMIT, Math.max(0, p.getInt(KEY_HISTORY_COUNT, 0)));
        SharedPreferences.Editor edit = p.edit();
        int lastDestination = Math.min(HISTORY_LIMIT - 1, count);
        for (int destination = lastDestination; destination >= 1; destination--) {
            int source = destination - 1;
            copyHistorySlot(p, edit, source, destination);
        }
        writeHistorySlot(edit, 0, record);
        edit.putInt(KEY_HISTORY_COUNT, Math.min(HISTORY_LIMIT, count + 1));
        edit.commit();
    }

    private static void copyHistorySlot(SharedPreferences p, SharedPreferences.Editor edit, int source, int destination) {
        edit.putString(historyKey(destination, "prompt"), p.getString(historyKey(source, "prompt"), ""));
        edit.putString(historyKey(destination, "result"), p.getString(historyKey(source, "result"), ""));
        edit.putString(historyKey(destination, "state"), p.getString(historyKey(source, "state"), FAILED));
        edit.putString(historyKey(destination, "error"), p.getString(historyKey(source, "error"), ""));
        edit.putLong(historyKey(destination, "startedAt"), p.getLong(historyKey(source, "startedAt"), 0L));
        edit.putLong(historyKey(destination, "finishedAt"), p.getLong(historyKey(source, "finishedAt"), 0L));
    }

    private static void writeHistorySlot(SharedPreferences.Editor edit, int index, TaskRecord record) {
        edit.putString(historyKey(index, "prompt"), record.prompt);
        edit.putString(historyKey(index, "result"), record.result);
        edit.putString(historyKey(index, "state"), record.state);
        edit.putString(historyKey(index, "error"), record.error);
        edit.putLong(historyKey(index, "startedAt"), record.startedAt);
        edit.putLong(historyKey(index, "finishedAt"), record.finishedAt);
    }

    private static String historyKey(int index, String field) {
        return "history." + index + "." + field;
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
        public final long finishedAt;
        public final boolean boundaryCaptured;
        public final Set<String> baselineHashes;
        public final int baselineMarkerCount;

        Snapshot(String prompt, String result, String state, String error, long startedAt, long updatedAt,
                 long finishedAt, boolean boundaryCaptured, Set<String> baselineHashes, int baselineMarkerCount) {
            this.prompt = prompt == null ? "" : prompt;
            this.result = result == null ? "" : result;
            this.state = state == null ? IDLE : state;
            this.error = error == null ? "" : error;
            this.startedAt = startedAt;
            this.updatedAt = updatedAt;
            this.finishedAt = finishedAt;
            this.boundaryCaptured = boundaryCaptured;
            this.baselineHashes = baselineHashes == null ? new HashSet<>() : new HashSet<>(baselineHashes);
            this.baselineMarkerCount = baselineMarkerCount;
        }

        public boolean active() {
            return QUEUED.equals(state) || INPUT_SET.equals(state) || SUBMITTED.equals(state);
        }
    }

    public static final class TaskRecord {
        public final String prompt;
        public final String result;
        public final String state;
        public final String error;
        public final long startedAt;
        public final long finishedAt;

        TaskRecord(String prompt, String result, String state, String error, long startedAt, long finishedAt) {
            this.prompt = prompt == null ? "" : prompt;
            this.result = result == null ? "" : result;
            this.state = state == null ? FAILED : state;
            this.error = error == null ? "" : error;
            this.startedAt = startedAt;
            this.finishedAt = finishedAt;
        }
    }
}
