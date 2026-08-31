package ai.tigeriq.worker.v07;

import android.content.Context;
import android.content.SharedPreferences;

public final class DurableCheckpointStore {
    private static final String PREFS = "tigeriq_v07_checkpoint";
    private final SharedPreferences prefs;

    public DurableCheckpointStore(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public void save(String jobId, String leaseTokenHash, String phase, long updatedAtEpochMs) {
        prefs.edit()
                .putString("jobId", emptyToNull(jobId))
                .putString("leaseTokenHash", emptyToNull(leaseTokenHash))
                .putString("phase", emptyToNull(phase))
                .putLong("updatedAt", updatedAtEpochMs)
                .apply();
    }

    public Snapshot load() {
        return new Snapshot(
                prefs.getString("jobId", null),
                prefs.getString("leaseTokenHash", null),
                prefs.getString("phase", null),
                prefs.getLong("updatedAt", 0L));
    }

    public void clear() {
        prefs.edit().clear().apply();
    }

    public record Snapshot(String jobId, String leaseTokenHash, String phase, long updatedAtEpochMs) {
        public boolean hasInFlightWork() {
            return jobId != null && !jobId.isBlank() && phase != null && !phase.isBlank();
        }
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
