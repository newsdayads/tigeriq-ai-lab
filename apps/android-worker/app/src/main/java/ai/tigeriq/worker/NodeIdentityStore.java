package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;
import java.util.UUID;

/** One install/device gets one stable TigerIQ node id independent from employee profile edits. */
public final class NodeIdentityStore {
    private static final String PREFS = "tigeriq-worker-node";
    private static final String KEY_NODE_ID = "nodeId";

    private final SharedPreferences prefs;

    public NodeIdentityStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized String getOrCreate() {
        String existing = prefs.getString(KEY_NODE_ID, null);
        if (existing != null && !existing.trim().isEmpty()) return existing;
        String compact = UUID.randomUUID().toString().replace("-", "").substring(0, 16).toUpperCase(Locale.US);
        String nodeId = "PHONE-" + compact;
        prefs.edit().putString(KEY_NODE_ID, nodeId).commit();
        return nodeId;
    }
}
