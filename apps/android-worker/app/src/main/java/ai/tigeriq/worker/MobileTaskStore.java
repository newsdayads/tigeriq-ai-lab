package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/** Durable binding between one Core-issued mobile task and the local ChatGPT run. */
public final class MobileTaskStore {
    private static final String PREFS = "tigeriq-mobile-task";
    private static final String K_TASK_ID = "taskId";
    private static final String K_LEASE_ID = "leaseId";
    private static final String K_RUN_ID = "runId";
    private static final String K_PROMPT = "prompt";
    private static final String K_EXPECTED_TOKEN = "expectedToken";
    private static final String K_RESULT_REPORTED = "resultReported";

    private MobileTaskStore() {}

    public static Snapshot read(Context context) {
        SharedPreferences p=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
        return new Snapshot(
            p.getString(K_TASK_ID,""),
            p.getString(K_LEASE_ID,""),
            p.getString(K_RUN_ID,""),
            p.getString(K_PROMPT,""),
            p.getString(K_EXPECTED_TOKEN,""),
            p.getBoolean(K_RESULT_REPORTED,false)
        );
    }

    public static Snapshot bind(Context context, JSONObject task) throws Exception {
        String taskId=required(task.optString("taskId",""),"taskId");
        String leaseId=required(task.optString("leaseId",""),"leaseId");
        String runId=required(task.optString("runId",""),"runId");
        String prompt=required(task.optString("prompt",""),"prompt");
        String expectedToken=required(task.optString("expectedToken",""),"expectedToken");
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit()
            .clear()
            .putString(K_TASK_ID,taskId)
            .putString(K_LEASE_ID,leaseId)
            .putString(K_RUN_ID,runId)
            .putString(K_PROMPT,prompt)
            .putString(K_EXPECTED_TOKEN,expectedToken)
            .putBoolean(K_RESULT_REPORTED,false)
            .apply();
        return read(context);
    }

    public static void markResultReported(Context context) {
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit()
            .putBoolean(K_RESULT_REPORTED,true)
            .apply();
    }

    public static void clear(Context context) {
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().clear().apply();
    }

    private static String required(String value,String name) {
        if(value==null||value.trim().isEmpty())throw new IllegalArgumentException(name+" is required");
        return value.trim();
    }

    public static final class Snapshot {
        public final String taskId;
        public final String leaseId;
        public final String runId;
        public final String prompt;
        public final String expectedToken;
        public final boolean resultReported;

        Snapshot(String taskId,String leaseId,String runId,String prompt,String expectedToken,boolean resultReported) {
            this.taskId=taskId;
            this.leaseId=leaseId;
            this.runId=runId;
            this.prompt=prompt;
            this.expectedToken=expectedToken;
            this.resultReported=resultReported;
        }

        public boolean present() {
            return !taskId.isEmpty()&&!leaseId.isEmpty()&&!runId.isEmpty();
        }
    }
}
