package ai.tigeriq.worker.v07;

import android.content.Context;
import android.content.SharedPreferences;

public final class WorkerStatusStore {
    private static final String PREFS = "tigeriq_v07_status";
    private final SharedPreferences prefs;
    public WorkerStatusStore(Context context) { prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    public synchronized void setState(WorkerState state, String message, String jobId) { prefs.edit().putString("state", state.name()).putString("message", message == null ? "" : message).putString("jobId", jobId == null ? "" : jobId).putLong("updatedAt", System.currentTimeMillis()).commit(); }
    public synchronized void setPushState(String value) { prefs.edit().putString("pushState", value == null ? "UNKNOWN" : value).putLong("updatedAt", System.currentTimeMillis()).commit(); }
    public synchronized void setLastEvidence(String ref) { prefs.edit().putString("lastEvidence", ref == null ? "" : ref).commit(); }
    public synchronized Snapshot load() {
        WorkerState state; try { state = WorkerState.valueOf(prefs.getString("state", WorkerState.NEED_ATTENTION.name())); } catch (Exception ignored) { state = WorkerState.NEED_ATTENTION; }
        return new Snapshot(state, prefs.getString("message", "Chưa đăng ký thiết bị"), prefs.getString("jobId", ""), prefs.getString("pushState", "UNKNOWN"), prefs.getString("lastEvidence", ""), prefs.getLong("updatedAt", 0L));
    }
    public static final class Snapshot {
        public final WorkerState state; public final String message, jobId, pushState, lastEvidence; public final long updatedAtEpochMs;
        Snapshot(WorkerState state, String message, String jobId, String pushState, String lastEvidence, long updatedAtEpochMs) { this.state = state; this.message = message; this.jobId = jobId; this.pushState = pushState; this.lastEvidence = lastEvidence; this.updatedAtEpochMs = updatedAtEpochMs; }
    }
}
