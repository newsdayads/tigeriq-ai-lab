package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.UUID;

/** Durable exactly-once state for the approved ChatGPT B1 physical pilot. */
public final class ChatGptB1RunStore {
    public static final String PREFS = "tigeriq-chatgpt-b1";
    public static final String EXPECTED_PREFIX = "TIGERIQ_B1_OK_";
    public static final String REQUIRED_PROJECT = "TigerIQ AI Lab";
    public static final long MIN_FILL_TO_SEND_MS = 3000L;
    public static final long INTER_CYCLE_COOLDOWN_MS = 6000L;

    private static final String K_RUN_ID = "runId";
    private static final String K_STATE = "state";
    private static final String K_TARGET = "targetCycles";
    private static final String K_CYCLE = "cycle";
    private static final String K_COMPLETED = "completedCycles";
    private static final String K_SENT_CYCLE = "sentCycle";
    private static final String K_SEND_COUNT = "sendCount";
    private static final String K_DUPLICATE_COUNT = "duplicateSendCount";
    private static final String K_RECOVERY_COUNT = "recoveryCount";
    private static final String K_STARTED_AT = "startedAt";
    private static final String K_CYCLE_STARTED_AT = "cycleStartedAt";
    private static final String K_SENT_AT = "sentAt";
    private static final String K_NEXT_ACTION_AT = "nextActionAt";
    private static final String K_BUSY_SEEN = "busySeen";
    private static final String K_LAST_ERROR = "lastError";
    private static final String K_LATENCIES = "latenciesMs";
    private static final String K_EVIDENCE_SEQ = "evidenceSeq";
    private static final String K_REPORTED_SEQ = "reportedSeq";
    private static final String K_PROJECT_BOUND = "projectBound";
    private static final String K_PROJECT_BOUND_AT = "projectBoundAt";

    private ChatGptB1RunStore() {}

    public static Snapshot start(Context context, int requestedCycles) {
        int target = Math.max(1, Math.min(10, requestedCycles));
        String runId = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
            .putString(K_RUN_ID, runId)
            .putString(K_STATE, "WAITING_PROJECT")
            .putInt(K_TARGET, target)
            .putInt(K_CYCLE, 1)
            .putInt(K_COMPLETED, 0)
            .putInt(K_SENT_CYCLE, 0)
            .putInt(K_SEND_COUNT, 0)
            .putInt(K_DUPLICATE_COUNT, 0)
            .putInt(K_RECOVERY_COUNT, 0)
            .putLong(K_STARTED_AT, now)
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_NEXT_ACTION_AT, now)
            .putBoolean(K_BUSY_SEEN, false)
            .putString(K_LAST_ERROR, "")
            .putString(K_LATENCIES, "")
            .putInt(K_EVIDENCE_SEQ, 0)
            .putInt(K_REPORTED_SEQ, 0)
            .putBoolean(K_PROJECT_BOUND, false)
            .putLong(K_PROJECT_BOUND_AT, 0L)
            .apply();
        return read(context);
    }

    public static void cancel(Context context) {
        Snapshot s = read(context);
        if (!s.active()) return;
        finish(context, "CANCELLED", "cancelled_by_owner");
    }

    public static Snapshot read(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return new Snapshot(
            p.getString(K_RUN_ID, ""),
            p.getString(K_STATE, "IDLE"),
            p.getInt(K_TARGET, 0),
            p.getInt(K_CYCLE, 0),
            p.getInt(K_COMPLETED, 0),
            p.getInt(K_SENT_CYCLE, 0),
            p.getInt(K_SEND_COUNT, 0),
            p.getInt(K_DUPLICATE_COUNT, 0),
            p.getInt(K_RECOVERY_COUNT, 0),
            p.getLong(K_STARTED_AT, 0L),
            p.getLong(K_CYCLE_STARTED_AT, 0L),
            p.getLong(K_SENT_AT, 0L),
            p.getLong(K_NEXT_ACTION_AT, 0L),
            p.getBoolean(K_BUSY_SEEN, false),
            p.getString(K_LAST_ERROR, ""),
            p.getString(K_LATENCIES, ""),
            p.getInt(K_EVIDENCE_SEQ, 0),
            p.getInt(K_REPORTED_SEQ, 0),
            p.getBoolean(K_PROJECT_BOUND, false),
            p.getLong(K_PROJECT_BOUND_AT, 0L)
        );
    }

    public static String expectedToken(Snapshot s) {
        return EXPECTED_PREFIX + s.cycle;
    }

    public static String prompt(Snapshot s) {
        return "Bài kiểm tra TigerIQ B1 chu kỳ " + s.cycle + "/" + s.targetCycles
            + ". Hãy ghép đúng bốn phần sau thành một chuỗi duy nhất và chỉ trả lời chuỗi kết quả, không thêm nội dung khác: "
            + "TIGERIQ_ + B1_ + OK_ + " + s.cycle;
    }

    public static void markProjectBound(Context context) {
        long now = System.currentTimeMillis();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(K_PROJECT_BOUND, true)
            .putLong(K_PROJECT_BOUND_AT, now)
            .putString(K_STATE, "REQUESTED")
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_NEXT_ACTION_AT, now + 750L)
            .putString(K_LAST_ERROR, "")
            .apply();
    }

    public static void markVerifying(Context context) {
        writeState(context, "VERIFYING_CONTEXT", "");
    }

    public static void markInputReady(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, "INPUT_READY")
            .putLong(K_NEXT_ACTION_AT, System.currentTimeMillis() + MIN_FILL_TO_SEND_MS)
            .putString(K_LAST_ERROR, "")
            .apply();
    }

    public static boolean markSentExactlyOnce(Context context) {
        Snapshot s = read(context);
        if (s.sentCycle == s.cycle) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt(K_DUPLICATE_COUNT, s.duplicateSendCount + 1)
                .apply();
            return false;
        }
        long now = System.currentTimeMillis();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, "WAITING_AI")
            .putInt(K_SENT_CYCLE, s.cycle)
            .putInt(K_SEND_COUNT, s.sendCount + 1)
            .putLong(K_SENT_AT, now)
            .putBoolean(K_BUSY_SEEN, false)
            .putString(K_LAST_ERROR, "")
            .apply();
        return true;
    }

    public static void markBusySeen(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(K_BUSY_SEEN, true)
            .apply();
    }

    public static void markRecovery(Context context) {
        Snapshot s = read(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(K_RECOVERY_COUNT, s.recoveryCount + 1)
            .apply();
    }

    public static void completeCurrentCycle(Context context) {
        Snapshot s = read(context);
        if (!s.active() || s.cycle <= 0) return;
        long now = System.currentTimeMillis();
        long latency = s.sentAt > 0 ? Math.max(0L, now - s.sentAt) : 0L;
        String latencies = appendLatency(s.latenciesMs, latency);
        int completed = Math.max(s.completedCycles, s.cycle);
        if (completed >= s.targetCycles) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt(K_COMPLETED, completed)
                .putString(K_LATENCIES, latencies)
                .apply();
            finish(context, "COMPLETE", "");
            return;
        }

        int nextCycle = completed + 1;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, "REQUESTED")
            .putInt(K_COMPLETED, completed)
            .putInt(K_CYCLE, nextCycle)
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_SENT_AT, 0L)
            .putLong(K_NEXT_ACTION_AT, now + INTER_CYCLE_COOLDOWN_MS)
            .putBoolean(K_BUSY_SEEN, false)
            .putString(K_LAST_ERROR, "")
            .putString(K_LATENCIES, latencies)
            .apply();
    }

    public static void fail(Context context, String code) {
        finish(context, "ERROR", trim(code, 120));
    }

    public static void markReported(Context context, int seq) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(K_REPORTED_SEQ, seq)
            .apply();
    }

    public static JSONObject evidencePayload(Context context) throws Exception {
        Snapshot s = read(context);
        JSONObject payload = new JSONObject();
        payload.put("kind", "chatgpt_b1");
        payload.put("runId", s.runId);
        payload.put("seq", s.evidenceSeq);
        JSONObject body = new JSONObject();
        body.put("state", s.state);
        body.put("targetCycles", s.targetCycles);
        body.put("completedCycles", s.completedCycles);
        body.put("sendCount", s.sendCount);
        body.put("duplicateSendCount", s.duplicateSendCount);
        body.put("recoveryCount", s.recoveryCount);
        body.put("busySeen", s.busySeen);
        body.put("startedAt", s.startedAt);
        body.put("lastError", s.lastError);
        body.put("latenciesMs", s.latenciesMs);
        body.put("requiredProject", REQUIRED_PROJECT);
        body.put("projectBound", s.projectBound);
        body.put("projectBoundAt", s.projectBoundAt);
        body.put("minFillToSendMs", MIN_FILL_TO_SEND_MS);
        body.put("interCycleCooldownMs", INTER_CYCLE_COOLDOWN_MS);
        body.put("workerVersion", WorkerVersion.NAME);
        body.put("nodeId", new NodeIdentityStore(context).getOrCreate());
        payload.put("payload", body);
        return payload;
    }

    private static void finish(Context context, String state, String error) {
        Snapshot s = read(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, state)
            .putString(K_LAST_ERROR, error)
            .putInt(K_EVIDENCE_SEQ, s.evidenceSeq + 1)
            .apply();
    }

    private static void writeState(Context context, String state, String error) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, state)
            .putString(K_LAST_ERROR, error)
            .apply();
    }

    private static String appendLatency(String existing, long latency) {
        if (existing == null || existing.isEmpty()) return Long.toString(latency);
        return existing + "," + latency;
    }

    private static String trim(String value, int max) {
        if (value == null) return "";
        String normalized = value.replace('\n', ' ').replace('\r', ' ').trim();
        return normalized.length() <= max ? normalized : normalized.substring(0, max);
    }

    public static final class Snapshot {
        public final String runId;
        public final String state;
        public final int targetCycles;
        public final int cycle;
        public final int completedCycles;
        public final int sentCycle;
        public final int sendCount;
        public final int duplicateSendCount;
        public final int recoveryCount;
        public final long startedAt;
        public final long cycleStartedAt;
        public final long sentAt;
        public final long nextActionAt;
        public final boolean busySeen;
        public final String lastError;
        public final String latenciesMs;
        public final int evidenceSeq;
        public final int reportedSeq;
        public final boolean projectBound;
        public final long projectBoundAt;

        Snapshot(
            String runId,
            String state,
            int targetCycles,
            int cycle,
            int completedCycles,
            int sentCycle,
            int sendCount,
            int duplicateSendCount,
            int recoveryCount,
            long startedAt,
            long cycleStartedAt,
            long sentAt,
            long nextActionAt,
            boolean busySeen,
            String lastError,
            String latenciesMs,
            int evidenceSeq,
            int reportedSeq,
            boolean projectBound,
            long projectBoundAt
        ) {
            this.runId = runId;
            this.state = state;
            this.targetCycles = targetCycles;
            this.cycle = cycle;
            this.completedCycles = completedCycles;
            this.sentCycle = sentCycle;
            this.sendCount = sendCount;
            this.duplicateSendCount = duplicateSendCount;
            this.recoveryCount = recoveryCount;
            this.startedAt = startedAt;
            this.cycleStartedAt = cycleStartedAt;
            this.sentAt = sentAt;
            this.nextActionAt = nextActionAt;
            this.busySeen = busySeen;
            this.lastError = lastError;
            this.latenciesMs = latenciesMs;
            this.evidenceSeq = evidenceSeq;
            this.reportedSeq = reportedSeq;
            this.projectBound = projectBound;
            this.projectBoundAt = projectBoundAt;
        }

        public boolean active() {
            return "WAITING_PROJECT".equals(state)
                || "REQUESTED".equals(state)
                || "VERIFYING_CONTEXT".equals(state)
                || "INPUT_READY".equals(state)
                || "WAITING_AI".equals(state);
        }

        public boolean terminal() {
            return "COMPLETE".equals(state) || "ERROR".equals(state) || "CANCELLED".equals(state);
        }
    }
}
