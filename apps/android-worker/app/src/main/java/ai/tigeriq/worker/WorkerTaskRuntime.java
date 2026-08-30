package ai.tigeriq.worker;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

/**
 * Executes only deterministic Worker-owned tasks. Third-party AI/UI automation is intentionally
 * outside this runtime and must be added through a separately gated adapter.
 */
public final class WorkerTaskRuntime {
    public static final String CAPABILITY_SELF_TEST = "worker-self-test";

    private WorkerTaskRuntime() {}

    public static JSONObject execute(Context context, JSONObject lease) throws Exception {
        JSONObject task = lease.getJSONObject("task");
        String taskId = required(lease, "taskId");
        String employeeId = required(lease, "employeeId");
        if (!taskId.equals(required(task, "taskId"))) throw new IllegalArgumentException("lease task mismatch");

        JSONArray capabilities = task.optJSONArray("requiredCapabilities");
        if (contains(capabilities, CAPABILITY_SELF_TEST)) {
            return selfTest(context, taskId, employeeId);
        }
        return failure(taskId, employeeId, "UNSUPPORTED_TASK", "Worker has no enabled adapter for this task.", true);
    }

    private static JSONObject selfTest(Context context, String taskId, String employeeId) throws Exception {
        boolean accessibility = false;
        try {
            String enabled = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            accessibility = enabled != null && enabled.contains(context.getPackageName());
        } catch (Exception ignored) {
            accessibility = false;
        }

        JSONObject artifact = new JSONObject();
        artifact.put("kind", "json");
        artifact.put("ref", "device://" + context.getPackageName() + "/self-test");
        artifact.put(
            "summary",
            "Worker " + WorkerVersion.NAME + " · " + Build.MANUFACTURER + " " + Build.MODEL +
            " · Android " + Build.VERSION.RELEASE + " · Accessibility " + (accessibility ? "ON" : "OFF")
        );

        JSONObject result = base(taskId, employeeId, "completed");
        result.put("conclusion", "TigerIQ Worker deterministic self-test completed on the assigned Android node.");
        result.put("confidence", 1.0);
        result.put("verdict", "pass");
        result.put("artifacts", new JSONArray().put(artifact));
        result.put("risks", new JSONArray());
        return result;
    }

    public static JSONObject failure(String taskId, String employeeId, String code, String message, boolean retriable) throws Exception {
        JSONObject result = base(taskId, employeeId, "failed");
        result.put("conclusion", "TigerIQ Worker did not complete the assigned task.");
        result.put("confidence", 0.0);
        result.put("artifacts", new JSONArray());
        result.put("risks", new JSONArray().put("android-worker-runtime"));
        JSONObject failure = new JSONObject();
        failure.put("code", code);
        failure.put("message", message == null ? "" : truncate(message, 240));
        failure.put("retriable", retriable);
        result.put("failure", failure);
        return result;
    }

    private static JSONObject base(String taskId, String employeeId, String status) throws Exception {
        JSONObject result = new JSONObject();
        result.put("taskId", taskId);
        result.put("employeeId", employeeId);
        result.put("status", status);
        result.put("completedAt", Instant.now().toString());
        return result;
    }

    private static boolean contains(JSONArray values, String expected) {
        if (values == null) return false;
        for (int i = 0; i < values.length(); i++) {
            if (expected.equals(values.optString(i))) return true;
        }
        return false;
    }

    private static String required(JSONObject object, String key) {
        String value = object.optString(key, "").trim();
        if (value.isEmpty()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
