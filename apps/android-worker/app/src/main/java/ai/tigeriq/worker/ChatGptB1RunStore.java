package ai.tigeriq.worker;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.UUID;

/** Durable exactly-once state for the approved ChatGPT B1 physical pilot. */
public final class ChatGptB1RunStore {
    public static final String PREFS = "tigeriq-chatgpt-b1";
    public static final String EXPECTED_PREFIX = "TIGERIQ_B1_OK_";
    public static final String REQUIRED_PROJECT = ChatGptB1Policy.REQUIRED_PROJECT;
    public static final long MIN_FILL_TO_SEND_MS = ChatGptB1Policy.MIN_FILL_TO_SEND_MS;
    public static final long INTER_CYCLE_COOLDOWN_MS = ChatGptB1Policy.INTER_CYCLE_COOLDOWN_MS;

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
    private static final String K_STARTED_ELAPSED_AT = "startedElapsedAt";
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
    private static final String K_PROJECT_MODE = "projectMode";
    private static final String K_TASK_ID = "taskId";
    private static final String K_CUSTOM_PROMPT = "customPrompt";
    private static final String K_CUSTOM_EXPECTED_TOKEN = "customExpectedToken";
    private static final String K_RESPONSE_TEXT = "responseText";

    private ChatGptB1RunStore() {}

    private static SharedPreferences.Editor newRunEditor(
        Context context, int requestedCycles, String runId
    ) {
        int target = Math.max(1, Math.min(10, requestedCycles));
        long now = System.currentTimeMillis();
        long nowElapsed = SystemClock.elapsedRealtime();
        // One editor clears the previous run and stages the entire next identity.
        // Core-specific keys are added before the ONE durable commit below.
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
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
            .putLong(K_STARTED_ELAPSED_AT, nowElapsed)
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_NEXT_ACTION_AT, now)
            .putBoolean(K_BUSY_SEEN, false)
            .putString(K_LAST_ERROR, "")
            .putString(K_LATENCIES, "")
            .putString(K_RESPONSE_TEXT, "")
            .putInt(K_EVIDENCE_SEQ, 0)
            .putInt(K_REPORTED_SEQ, 0)
            .putBoolean(K_PROJECT_BOUND, false)
            .putLong(K_PROJECT_BOUND_AT, 0L)
            .putString(K_PROJECT_MODE, "WAITING_PROJECT");
    }

    public static synchronized Snapshot start(Context context, int requestedCycles) {
        // Manual B1 retains its existing asynchronous initialization contract.
        newRunEditor(context, requestedCycles, UUID.randomUUID().toString()).apply();
        return read(context);
    }

    public static synchronized Snapshot startTask(Context context, String runId, String taskId, String prompt, String expectedToken) {
        if (runId == null || runId.trim().isEmpty()) throw new IllegalArgumentException("runId is required");
        if (taskId == null || taskId.trim().isEmpty()) throw new IllegalArgumentException("taskId is required");
        if (prompt == null || prompt.trim().isEmpty()) throw new IllegalArgumentException("prompt is required");
        if (expectedToken == null || expectedToken.trim().isEmpty()) throw new IllegalArgumentException("expectedToken is required");
        // Never publish a temporary manual/anonymous run between two applies.
        // If killed during initiation, either the old state or the fully bound
        // Core run survives; a partial Core task must not enter manual fallback.
        boolean durable = newRunEditor(context, 1, runId.trim())
            .putString(K_TASK_ID, taskId.trim())
            .putString(K_CUSTOM_PROMPT, prompt.trim())
            .putString(K_CUSTOM_EXPECTED_TOKEN, expectedToken.trim())
            .commit();
        if (!durable) throw new IllegalStateException("CORE_TASK_START_PERSIST_FAILED");
        return read(context);
    }

    public static synchronized void cancel(Context context) {
        Snapshot s = read(context);
        if (!s.active()) return;
        finish(context, "CANCELLED", "cancelled_by_owner");
    }

    public static synchronized boolean cancelStaleManualRunForLiveWorker(Context context) {
        Snapshot s = read(context);
        if (!s.active() || (s.taskId != null && !s.taskId.isEmpty())) return false;
        finish(context, "CANCELLED", "superseded_by_live_worker");
        return true;
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
            p.getLong(K_STARTED_ELAPSED_AT, 0L),
            p.getLong(K_CYCLE_STARTED_AT, 0L),
            p.getLong(K_SENT_AT, 0L),
            p.getLong(K_NEXT_ACTION_AT, 0L),
            p.getBoolean(K_BUSY_SEEN, false),
            p.getString(K_LAST_ERROR, ""),
            p.getString(K_LATENCIES, ""),
            p.getInt(K_EVIDENCE_SEQ, 0),
            p.getInt(K_REPORTED_SEQ, 0),
            p.getBoolean(K_PROJECT_BOUND, false),
            p.getLong(K_PROJECT_BOUND_AT, 0L),
            p.getString(K_PROJECT_MODE, "WAITING_PROJECT"),
            p.getString(K_TASK_ID, ""),
            p.getString(K_CUSTOM_PROMPT, ""),
            p.getString(K_CUSTOM_EXPECTED_TOKEN, ""),
            p.getString(K_RESPONSE_TEXT, "")
        );
    }

    public static String expectedToken(Snapshot s) {
        if (s.customExpectedToken != null && !s.customExpectedToken.isEmpty()) return s.customExpectedToken;
        return EXPECTED_PREFIX + s.cycle;
    }

    public static String prompt(Snapshot s) {
        if (s.customPrompt != null && !s.customPrompt.isEmpty()) return s.customPrompt;
        return "Bài kiểm tra TigerIQ B1 chu kỳ " + s.cycle + "/" + s.targetCycles
            + ". Hãy ghép đúng bốn phần sau thành một chuỗi duy nhất và chỉ trả lời chuỗi kết quả, không thêm nội dung khác: "
            + "TIGERIQ_ + B1_ + OK_ + " + s.cycle;
    }

    public static synchronized void markProjectBound(Context context) {
        long now = System.currentTimeMillis();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(K_PROJECT_BOUND, true)
            .putLong(K_PROJECT_BOUND_AT, now)
            .putString(K_PROJECT_MODE, "PROJECT")
            .putString(K_STATE, "REQUESTED")
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_NEXT_ACTION_AT, now + 750L)
            .putString(K_LAST_ERROR, "")
            .apply();
    }

    /**
     * Commit a Core Project binding only for the exact durable lease which
     * supplied the stable UI evidence. Manual B1 retains markProjectBound.
     */
    public static synchronized boolean markCoreProjectBoundIfCurrent(
        Context context, String observedRunId, String observedTaskId, int observedCycle
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canBindObservedCoreProject(
            observedRunId, observedTaskId, observedCycle,
            live.runId, live.taskId, live.cycle, live.state, live.projectBound
        )) return false;
        long now = System.currentTimeMillis();
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(K_PROJECT_BOUND, true)
            .putLong(K_PROJECT_BOUND_AT, now)
            .putString(K_PROJECT_MODE, "PROJECT")
            .putString(K_STATE, "REQUESTED")
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_NEXT_ACTION_AT, now + 750L)
            .putString(K_LAST_ERROR, "")
            .commit();
    }

    public static synchronized void markStandaloneFallbackReady(Context context) {
        long now = System.currentTimeMillis();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(K_PROJECT_BOUND, true)
            .putLong(K_PROJECT_BOUND_AT, now)
            .putString(K_PROJECT_MODE, "STANDALONE_FALLBACK")
            .putString(K_STATE, "REQUESTED")
            .putLong(K_CYCLE_STARTED_AT, now)
            .putLong(K_NEXT_ACTION_AT, now + 750L)
            .putString(K_LAST_ERROR, "")
            .apply();
    }

    /**
     * Core-specific state mutations are serialized with startTask and its
     * send/receipt commits. They never mutate a successor run observed by a
     * delayed Accessibility callback.
     */
    public static synchronized boolean markCoreVerifyingIfCurrent(
        Context context, String runId, String taskId, int cycle
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canMutateObservedCoreRun(
            runId, taskId, cycle, live.runId, live.taskId, live.cycle, live.state,
            "REQUESTED", "VERIFYING_CONTEXT"
        ) || !live.projectBound || !"PROJECT".equals(live.projectMode)) return false;
        writeState(context, "VERIFYING_CONTEXT", "");
        return true;
    }

    public static synchronized boolean markCoreInputReadyIfCurrent(
        Context context, String runId, String taskId, int cycle
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canMutateObservedCoreRun(
            runId, taskId, cycle, live.runId, live.taskId, live.cycle, live.state,
            "REQUESTED", "VERIFYING_CONTEXT"
        ) || !live.projectBound || !"PROJECT".equals(live.projectMode)) return false;
        markInputReady(context);
        return true;
    }

    public static synchronized boolean markCoreBusyIfCurrent(
        Context context, String runId, String taskId, int cycle
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canMutateObservedCoreRun(
            runId, taskId, cycle, live.runId, live.taskId, live.cycle, live.state,
            "WAITING_AI"
        )) return false;
        markBusySeen(context);
        return true;
    }

    /**
     * A stale failure event must never error or erase a new run. Use a durable
     * terminal write for Core so process restart retains the failure evidence.
     */
    public static synchronized boolean failCoreIfCurrent(
        Context context, String runId, String taskId, int cycle, String error
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canMutateObservedCoreRun(
            runId, taskId, cycle, live.runId, live.taskId, live.cycle, live.state,
            "WAITING_PROJECT", "REQUESTED", "VERIFYING_CONTEXT", "INPUT_READY", "WAITING_AI"
        )) return false;
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, "ERROR")
            .putString(K_LAST_ERROR, trim(error, 120))
            .putInt(K_EVIDENCE_SEQ, live.evidenceSeq + 1)
            .commit();
    }

    /** Revalidate after durable send claim, just before the irreversible click. */
    public static synchronized boolean isCoreSendClaimStillCurrent(
        Context context, String runId, String taskId, int cycle
    ) {
        Snapshot live = read(context);
        return ChatGptB1Policy.canMutateObservedCoreRun(
            runId, taskId, cycle, live.runId, live.taskId, live.cycle, live.state,
            "WAITING_AI"
        ) && live.sentCycle == live.cycle && live.sendCount == 1
            && live.duplicateSendCount == 0 && live.projectBound
            && "PROJECT".equals(live.projectMode);
    }

    public static void markVerifying(Context context) {
        writeState(context, "VERIFYING_CONTEXT", "");
    }

    public static void markInputReady(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, "INPUT_READY")
            .putLong(K_NEXT_ACTION_AT, ChatGptB1Policy.nextActionAfterFill(System.currentTimeMillis()))
            .putString(K_LAST_ERROR, "")
            .apply();
    }

    /**
     * Claim one send durably BEFORE ACTION_CLICK. If persistence fails, the
     * automation must not click; if the app crashes after this claim, it may
     * time out but it cannot retry a potentially sent message.
     */
    /**
     * Core send claim: compare live durable identity under the same lock that
     * serializes startTask, then commit before any physical ACTION_CLICK.
     * A stale callback must never claim a newly bound Core or manual run.
     */
    public static synchronized boolean markSentExactlyOnce(
        Context context, String expectedRunId, String expectedTaskId,
        int expectedCycle, String expectedPrompt
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canClaimCoreSendForSnapshot(
            expectedRunId, expectedTaskId, expectedCycle, expectedPrompt,
            live.runId, live.taskId, live.cycle, live.state, live.sentCycle,
            live.customPrompt, live.projectBound, live.projectMode
        )) return false;
        return persistSendClaim(context, live);
    }

    public static synchronized boolean markSentExactlyOnce(Context context) {
        return persistSendClaim(context, read(context));
    }

    private static boolean persistSendClaim(Context context, Snapshot s) {
        if (!ChatGptB1Policy.canClaimSendAttempt(s.state, s.cycle, s.sentCycle)) {
            if (s.sentCycle == s.cycle && s.cycle > 0) {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putInt(K_DUPLICATE_COUNT, s.duplicateSendCount + 1)
                    .apply();
            }
            return false;
        }
        long now = System.currentTimeMillis();
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_STATE, "WAITING_AI")
            .putInt(K_SENT_CYCLE, s.cycle)
            .putInt(K_SEND_COUNT, s.sendCount + 1)
            .putLong(K_SENT_AT, now)
            .putBoolean(K_BUSY_SEEN, false)
            .putString(K_LAST_ERROR, "")
            .commit();
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
        completeCurrentCycle(context, "");
    }

    /**
     * Core response commit: the conversation snapshot is advisory. Reject if
     * the durable run was replaced or changed while Accessibility scanned it.
     * Never complete a different task using the old UI's response token.
     */
    public static synchronized boolean completeCoreReplyIfCurrent(
        Context context, String expectedRunId, String expectedTaskId,
        int expectedCycle, String expectedToken, String responseText
    ) {
        Snapshot live = read(context);
        if (!ChatGptB1Policy.canCompleteCoreReplyForSnapshot(
            expectedRunId, expectedTaskId, expectedCycle, expectedToken,
            responseText, live.runId, live.taskId, live.cycle, live.state,
            live.sentCycle, live.sendCount, live.duplicateSendCount,
            expectedToken(live), live.projectBound, live.projectMode
        )) return false;
        finishCycleFromSnapshot(context, live, responseText);
        return true;
    }

    public static void completeCurrentCycle(Context context, String responseText) {
        finishCycleFromSnapshot(context, read(context), responseText);
    }

    private static void finishCycleFromSnapshot(
        Context context, Snapshot s, String responseText
    ) {
        if (!s.active() || s.cycle <= 0) return;
        long now = System.currentTimeMillis();
        long latency = s.sentAt > 0 ? Math.max(0L, now - s.sentAt) : 0L;
        String latencies = appendLatency(s.latenciesMs, latency);
        int completed = Math.max(s.completedCycles, s.cycle);
        if (completed >= s.targetCycles) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt(K_COMPLETED, completed)
                .putString(K_LATENCIES, latencies)
                .putString(K_RESPONSE_TEXT, trimResponse(responseText, 4000))
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
            .putLong(K_NEXT_ACTION_AT, ChatGptB1Policy.nextActionAfterCycle(now))
            .putBoolean(K_BUSY_SEEN, false)
            .putString(K_LAST_ERROR, "")
            .putString(K_LATENCIES, latencies)
            .apply();
    }

    public static synchronized boolean failWaitingProjectIfTimedOut(
        Context context,
        String expectedRunId,
        String expectedTaskId,
        long nowElapsedMs
    ) {
        Snapshot current = read(context);
        if (expectedRunId == null || expectedTaskId == null) return false;
        if (!expectedRunId.equals(current.runId) || !expectedTaskId.equals(current.taskId)) return false;
        if (!"WAITING_PROJECT".equals(current.state) || current.projectBound) return false;

        long anchor = current.startedElapsedAt;
        if (ChatGptB1Policy.projectBindElapsedAnchorInvalid(anchor, nowElapsedMs)) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(K_STARTED_ELAPSED_AT, nowElapsedMs)
                .apply();
            return false;
        }
        if (!ChatGptB1Policy.shouldTimeoutBoundTask(
            expectedRunId,
            expectedTaskId,
            current.runId,
            current.taskId,
            current.state,
            current.projectBound,
            anchor,
            nowElapsedMs
        )) return false;

        finish(context, "ERROR", "PROJECT_BIND_TIMEOUT");
        return true;
    }

    public static void fail(Context context, String code) {
        finish(context, "ERROR", trim(code, 120));
    }

    public static void markReported(Context context, int seq) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(K_REPORTED_SEQ, seq)
            .apply();
    }

    public static String projectGateModeForEvidence(Context context, Snapshot s) {
        SharedPreferences p = context.getSharedPreferences(
            AccessibilityBridgeService.PREFS, Context.MODE_PRIVATE
        );
        return ChatGptB1Policy.safeProjectGateModeForEvidence(
            p.getString(AccessibilityBridgeService.KEY_PROJECT_GATE_MODE, ""),
            p.getLong(AccessibilityBridgeService.KEY_PROJECT_GATE_AT, 0L),
            s.startedAt
        );
    }

    public static boolean projectClickObservedInRun(Context context, Snapshot s) {
        SharedPreferences prefs = context.getSharedPreferences(
            AccessibilityBridgeService.PREFS, Context.MODE_PRIVATE
        );
        long clickAt = prefs.getLong(AccessibilityBridgeService.KEY_AUTO_PROJECT_CLICK_AT, 0L);
        if (s.taskId != null && !s.taskId.isEmpty()) {
            return ChatGptB1Policy.isCoreProjectClickProofForRun(
                s.runId, s.taskId, s.cycle, s.startedAt,
                prefs.getString(AccessibilityBridgeService.KEY_AUTO_PROJECT_CLICK_RUN_ID, ""),
                prefs.getString(AccessibilityBridgeService.KEY_AUTO_PROJECT_CLICK_TASK_ID, ""),
                prefs.getInt(AccessibilityBridgeService.KEY_AUTO_PROJECT_CLICK_CYCLE, 0),
                clickAt
            );
        }
        return ChatGptB1Policy.projectClickObservedInRun(clickAt, s.startedAt);
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
        body.put("projectMode", s.projectMode);
        // Only enum-like gate state and same-run click presence. Do NOT report
        // KEY_PROJECT_GATE_DIAG; it may hold raw node lineage or chat text.
        body.put("projectGateMode", projectGateModeForEvidence(context, s));
        body.put("projectAutoClickSeen", projectClickObservedInRun(context, s));
        body.put("minFillToSendMs", MIN_FILL_TO_SEND_MS);
        body.put("interCycleCooldownMs", INTER_CYCLE_COOLDOWN_MS);
        body.put("workerVersion", WorkerVersion.NAME);
        body.put("nodeId", new NodeIdentityStore(context).getOrCreate());
        if (s.taskId != null && !s.taskId.isEmpty()) body.put("taskId", s.taskId);
        if (s.responseText != null && !s.responseText.isEmpty()) body.put("responseText", s.responseText);
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

    private static String trimResponse(String value, int max) {
        if (value == null) return "";
        String normalized = value.replace("\r", "").trim();
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
        public final long startedElapsedAt;
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
        public final String projectMode;
        public final String taskId;
        public final String customPrompt;
        public final String customExpectedToken;
        public final String responseText;

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
            long startedElapsedAt,
            long cycleStartedAt,
            long sentAt,
            long nextActionAt,
            boolean busySeen,
            String lastError,
            String latenciesMs,
            int evidenceSeq,
            int reportedSeq,
            boolean projectBound,
            long projectBoundAt,
            String projectMode,
            String taskId,
            String customPrompt,
            String customExpectedToken,
            String responseText
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
            this.startedElapsedAt = startedElapsedAt;
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
            this.projectMode = projectMode;
            this.taskId = taskId;
            this.customPrompt = customPrompt;
            this.customExpectedToken = customExpectedToken;
            this.responseText = responseText;
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
