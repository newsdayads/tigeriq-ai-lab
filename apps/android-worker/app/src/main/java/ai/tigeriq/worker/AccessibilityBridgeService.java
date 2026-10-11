package ai.tigeriq.worker;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Semantic bridge for provider observation plus the explicitly approved ChatGPT B1 pilot.
 *
 * B1 is bounded to harmless confirmation prompts, semantic ACTION_SET_TEXT/ACTION_CLICK,
 * exactly-once state, and recovery. It does not lease backlog work or mutate GitHub.
 */
public final class AccessibilityBridgeService extends AccessibilityService {
    public static final String PREFS = "tigeriq-accessibility-pilot";
    public static final String KEY_LAST_PACKAGE = "lastPackage";
    public static final String KEY_LAST_EVENT_AT = "lastEventAt";
    public static final String KEY_PROVIDER_PACKAGE = "providerPackage";
    public static final String KEY_PROVIDER_EVENT_AT = "providerEventAt";
    public static final String KEY_ROOT_AVAILABLE = "rootAvailable";
    public static final String KEY_NODE_COUNT = "nodeCount";
    public static final String KEY_EDITABLE_COUNT = "editableCount";
    public static final String KEY_CLICKABLE_COUNT = "clickableCount";
    public static final String KEY_PROJECT_GATE_DIAG = "projectGateDiag";
    public static final String KEY_PROJECT_GATE_MODE = "projectGateMode";
    public static final String KEY_PROJECT_GATE_AT = "projectGateAt";
    public static final String KEY_AUTO_PROJECT_CLICK_AT = "autoProjectClickAt";
    public static final String KEY_AUTO_PROJECT_CLICK_RUN_ID = "autoProjectClickRunId";
    public static final String KEY_AUTO_PROJECT_CLICK_TASK_ID = "autoProjectClickTaskId";
    public static final String KEY_AUTO_PROJECT_CLICK_CYCLE = "autoProjectClickCycle";
    public static final String KEY_AUTO_PROJECT_CLICK_COUNT = "autoProjectClickCount";
    public static final String KEY_STANDALONE_NEW_CHAT_AT = "standaloneNewChatAt";

    private static final int MAX_PROBE_NODES = 500;
    private static final String CHATGPT_PACKAGE = "com.openai.chatgpt";
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final String GOOGLE_APP_PACKAGE = "com.google.android.googlequicksearchbox";
    private static final int MAX_B1_RECOVERIES = 2;
    private static final long INACTIVE_TICK_MS = 2000L;
    private final Handler recoveryHandler = new Handler(Looper.getMainLooper());
    private boolean b1TickScheduled = false;
    // Handler runs on the main looper. Keep the 2.5s timer armed across 750ms ticks.
    private boolean recoveryPending = false;
    private String recoveryScheduledRunId = "";
    private String recoveryScheduledTaskId = "";
    private int recoveryScheduledCycle = 0;
    private long recoveryScheduledStartedAt = 0L;
    private int projectContextSamples = 0;
    private long projectContextFirstSeenAt = 0L;
    private String projectContextCandidateRunId = "";
    private String projectContextCandidateTaskId = "";
    private int projectContextCandidateCycle = 0;
    private long projectNavigationNextActionAt = 0L;

    private final Runnable b1TickRunnable = new Runnable() {
        @Override
        public void run() {
            if (WorkerRuntimeControl.isPaused(AccessibilityBridgeService.this)) {
                recoveryHandler.removeCallbacks(recoveryRunnable);
                recoveryPending = false;
                recoveryHandler.postDelayed(this, INACTIVE_TICK_MS);
                return;
            }
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(AccessibilityBridgeService.this);
            if (!run.active()) {
                recoveryHandler.postDelayed(this, INACTIVE_TICK_MS);
                return;
            }
            AccessibilityNodeInfo current = getRootInActiveWindow();
            CharSequence pkg = current == null ? null : current.getPackageName();
            if (pkg != null && CHATGPT_PACKAGE.equals(pkg.toString())) {
                recoveryHandler.removeCallbacks(recoveryRunnable);
                recoveryPending = false;
                driveProjectNavigationIfNeeded(current);
                maybeBindProjectFromStableContext(current);
                maybeActivateStandaloneFallback(current);
                ChatGptB1Automation.drive(AccessibilityBridgeService.this, current);
            } else {
                scheduleB1RecoveryIfNeeded();
            }
            recoveryHandler.postDelayed(this, 750L);
        }
    };

    private final Runnable recoveryRunnable = () -> {
        recoveryPending = false;
        if (WorkerRuntimeControl.isPaused(this)) return;
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.recoveryCount >= MAX_B1_RECOVERIES) return;
        // A delayed callback may belong to an earlier lease or a restarted
        // run with reused IDs. Never recover a successor from old UI evidence.
        if (!ChatGptB1Policy.isSameProjectContextCandidate(
            recoveryScheduledRunId, recoveryScheduledTaskId, recoveryScheduledCycle,
            run.runId, run.taskId, run.cycle
        ) || recoveryScheduledStartedAt != run.startedAt) return;
        AccessibilityNodeInfo current = getRootInActiveWindow();
        CharSequence pkg = current == null ? null : current.getPackageName();
        if (pkg != null && CHATGPT_PACKAGE.equals(pkg.toString())) return;
        boolean coreTask = run.taskId != null && !run.taskId.isEmpty();
        Intent launch = getPackageManager().getLaunchIntentForPackage(CHATGPT_PACKAGE);
        if (launch == null) {
            if (coreTask) {
                ChatGptB1RunStore.failCoreIfCurrent(
                    this, run.runId, run.taskId, run.cycle, "CHATGPT_NATIVE_APP_NOT_FOUND"
                );
            } else {
                ChatGptB1RunStore.fail(this, "CHATGPT_NATIVE_APP_NOT_FOUND");
            }
            return;
        }
        // Reserve a recovery slot durably while the original lease is still
        // current, before a native activity launch with non-atomic side effects.
        if (coreTask && !ChatGptB1RunStore.markCoreRecoveryIfCurrent(
            this, run.runId, run.taskId, run.cycle, MAX_B1_RECOVERIES
        )) return;
        if (!coreTask) ChatGptB1RunStore.markRecovery(this);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        ensureB1Ticker();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (WorkerRuntimeControl.isPaused(this)) return;
        CharSequence packageName = event == null ? null : event.getPackageName();
        if (packageName == null) return;

        String value = packageName.toString();
        if (getPackageName().equals(value)) return;

        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_LAST_PACKAGE, value)
            .putLong(KEY_LAST_EVENT_AT, System.currentTimeMillis())
            .apply();

        // Important: launcher/recents/keyboard events must not zero the last AI snapshot.
        if (!isPilotProvider(value)) {
            scheduleB1RecoveryIfNeeded();
            return;
        }

        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_PROVIDER_PACKAGE, value)
            .putLong(KEY_PROVIDER_EVENT_AT, System.currentTimeMillis())
            .apply();

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        CharSequence rootPackage = root.getPackageName();
        if (rootPackage == null || !value.equals(rootPackage.toString())) return;

        if (CHATGPT_PACKAGE.equals(value)) {
            recoveryHandler.removeCallbacks(recoveryRunnable);
            recoveryPending = false;
            maybeBindRequiredProject(event, root);
            driveProjectNavigationIfNeeded(root);
            maybeBindProjectFromStableContext(root);
            maybeActivateStandaloneFallback(root);
            ensureB1Ticker();
        }

        int nodes = 0;
        int editable = 0;
        int clickable = 0;
        Deque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty() && nodes < MAX_PROBE_NODES) {
            AccessibilityNodeInfo node = queue.removeFirst();
            nodes += 1;
            if (node.isEditable()) editable += 1;
            if (node.isClickable()) clickable += 1;
            int childCount = node.getChildCount();
            for (int i = 0; i < childCount && nodes + queue.size() < MAX_PROBE_NODES; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.addLast(child);
            }
        }
        writeProbe(true, nodes, editable, clickable);

        if (CHATGPT_PACKAGE.equals(value)) {
            ChatGptB1Automation.drive(this, root);
        }
    }

    private void maybeBindRequiredProject(AccessibilityEvent event, AccessibilityNodeInfo root) {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.projectBound || !"WAITING_PROJECT".equals(run.state)) return;
        if (event == null || !CHATGPT_PACKAGE.equals(String.valueOf(event.getPackageName()))) return;
        if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_CLICKED) return;

        AccessibilityNodeInfo source = event.getSource();
        boolean directLineageMatch = ChatGptB1Automation.nodeOrAncestorContainsLabel(
            source,
            ChatGptB1RunStore.REQUIRED_PROJECT,
            6
        );
        boolean localClickableScopeMatch = ChatGptB1Automation.localizedClickableAncestorContainsExactLabel(
            source,
            ChatGptB1RunStore.REQUIRED_PROJECT,
            4,
            12
        );
        boolean shouldBind = directLineageMatch || localClickableScopeMatch;
        boolean rootProjectVisible = root != null
            && ChatGptB1Automation.treeContainsExactLabel(root, ChatGptB1RunStore.REQUIRED_PROJECT);

        String mode = directLineageMatch
            ? "DIRECT_LINEAGE"
            : localClickableScopeMatch ? "LOCAL_CLICKABLE_SCOPE" : "CLICK_REJECTED";
        writeProjectDiag(
            mode,
            "rootProject=" + rootProjectVisible
                + "; direct=" + directLineageMatch
                + "; localScope=" + localClickableScopeMatch
                + "; lineage=" + compactDiag(ChatGptB1Automation.describeNodeLineage(source, 5))
        );

        // A click proves only the navigation attempt. It must NEVER set
        // projectBound=true before the stable Project-title + composer gate passes.
    }

    private void driveProjectNavigationIfNeeded(AccessibilityNodeInfo root) {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.projectBound || !"WAITING_PROJECT".equals(run.state) || root == null) return;

        long now = System.currentTimeMillis();
        if (now < projectNavigationNextActionAt) return;

        AccessibilityNodeInfo project = ChatGptB1Automation.findExactProjectControl(
            root,
            ChatGptB1RunStore.REQUIRED_PROJECT
        );
        if (project != null) {
            boolean clicked = project.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            if (clicked) {
                // The UI action could race with a Core lease replacement. Do
                // not write navigation proof for a successor run from this
                // callback's stale snapshot. Record the click's own identity.
                boolean coreTask = run.taskId != null && !run.taskId.isEmpty();
                if (coreTask) {
                    ChatGptB1RunStore.Snapshot live = ChatGptB1RunStore.read(this);
                    if (!ChatGptB1Policy.canBindObservedCoreProject(
                        run.runId, run.taskId, run.cycle,
                        live.runId, live.taskId, live.cycle,
                        live.state, live.projectBound
                    )) return;
                }
                android.content.SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                int count = prefs.getInt(KEY_AUTO_PROJECT_CLICK_COUNT, 0) + 1;
                prefs.edit()
                    .putLong(KEY_AUTO_PROJECT_CLICK_AT, System.currentTimeMillis())
                    .putString(KEY_AUTO_PROJECT_CLICK_RUN_ID, run.runId)
                    .putString(KEY_AUTO_PROJECT_CLICK_TASK_ID, run.taskId)
                    .putInt(KEY_AUTO_PROJECT_CLICK_CYCLE, run.cycle)
                    .putInt(KEY_AUTO_PROJECT_CLICK_COUNT, count)
                    .apply();
                writeProjectDiag(
                    "AUTO_PROJECT_CLICK",
                    "project=" + ChatGptB1RunStore.REQUIRED_PROJECT + "; clickCount=" + count
                );
                projectNavigationNextActionAt = now + ChatGptB1Policy.PROJECT_NAV_STEP_MS;
                resetProjectContextCandidate();
                return;
            }
        }

        AccessibilityNodeInfo menu = ChatGptB1Automation.findNavigationMenuControl(root);
        if (menu != null) {
            boolean clicked = menu.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            writeProjectDiag(
                clicked ? "AUTO_MENU_CLICK" : "AUTO_MENU_CLICK_FAILED",
                "semanticMenu=true"
            );
            projectNavigationNextActionAt = now + (clicked ? ChatGptB1Policy.PROJECT_NAV_STEP_MS : ChatGptB1Policy.PROJECT_NAV_RETRY_MS);
            return;
        }

        writeProjectDiag("AUTO_NAV_WAIT", "projectControl=false; menuControl=false");
        projectNavigationNextActionAt = now + ChatGptB1Policy.PROJECT_NAV_RETRY_MS;
    }

    private void maybeBindProjectFromStableContext(AccessibilityNodeInfo root) {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.projectBound || !"WAITING_PROJECT".equals(run.state)) {
            resetProjectContextCandidate();
            return;
        }

        boolean exactProject = root != null
            && ChatGptB1Automation.treeContainsExactLabel(root, ChatGptB1RunStore.REQUIRED_PROJECT);
        boolean projectTitleContext = root != null
            && ChatGptB1Automation.treeContainsExactLabelOutsideClickableNavigation(
                root,
                ChatGptB1RunStore.REQUIRED_PROJECT,
                3
            );
        boolean composerReady = root != null && ChatGptB1Automation.findComposerInput(root) != null;
        android.content.SharedPreferences navigationPrefs = getSharedPreferences(
            PREFS, Context.MODE_PRIVATE
        );
        long autoProjectClickAt = navigationPrefs.getLong(KEY_AUTO_PROJECT_CLICK_AT, 0L);
        boolean coreTask = run.taskId != null && !run.taskId.isEmpty();
        boolean autoNavigationProof = coreTask
            ? ChatGptB1Policy.isCoreProjectClickProofForRun(
                run.runId, run.taskId, run.cycle, run.startedAt,
                navigationPrefs.getString(KEY_AUTO_PROJECT_CLICK_RUN_ID, ""),
                navigationPrefs.getString(KEY_AUTO_PROJECT_CLICK_TASK_ID, ""),
                navigationPrefs.getInt(KEY_AUTO_PROJECT_CLICK_CYCLE, 0),
                autoProjectClickAt
            )
            : ChatGptB1Policy.projectClickObservedInRun(autoProjectClickAt, run.startedAt);
        // Core tasks must have a Project navigation click from THIS run.
        // A lookalike ordinary chat can have the same toolbar title. Manual B1
        // retains its prior stable-title/composer-only binding behavior.
        // This click is necessary, not sufficient: live title and composer
        // still have to remain stable independently.
        boolean contextProof = projectTitleContext
            && (!coreTask || autoNavigationProof);

        if (!exactProject || !composerReady || !contextProof) {
            if (projectContextSamples > 0 || exactProject) {
                writeProjectDiag(
                    "CONTEXT_WAIT",
                    "exactProject=" + exactProject
                        + "; titleContext=" + projectTitleContext
                        + "; autoNav=" + autoNavigationProof
                        + "; composer=" + composerReady
                        + "; samples=" + projectContextSamples
                );
            }
            resetProjectContextCandidate();
            return;
        }

        // Context samples are not transferable across newly leased Core tasks.
        // Two distinct runs viewing the same header must earn independent
        // stable-time and sample-count proofs before Project binding.
        if (projectContextSamples > 0
            && !ChatGptB1Policy.isSameProjectContextCandidate(
                projectContextCandidateRunId, projectContextCandidateTaskId,
                projectContextCandidateCycle, run.runId, run.taskId, run.cycle
            )) {
            resetProjectContextCandidate();
        }
        long now = System.currentTimeMillis();
        if (projectContextSamples == 0) {
            projectContextFirstSeenAt = now;
            projectContextCandidateRunId = run.runId;
            projectContextCandidateTaskId = run.taskId;
            projectContextCandidateCycle = run.cycle;
        }
        projectContextSamples += 1;
        long stableMs = Math.max(0L, now - projectContextFirstSeenAt);

        writeProjectDiag(
            "CONTEXT_CANDIDATE",
            "exactProject=true; contextProof=true; composer=true"
                + "; samples=" + projectContextSamples
                + "; stableMs=" + stableMs
        );

        if (ChatGptB1Policy.canBindStableProjectContextForTask(
            run.taskId, exactProject, projectTitleContext, composerReady,
            autoNavigationProof, projectContextSamples, stableMs
        )) {
            boolean bound;
            if (coreTask) {
                bound = ChatGptB1RunStore.markCoreProjectBoundIfCurrent(
                    this, run.runId, run.taskId, run.cycle
                );
            } else {
                ChatGptB1RunStore.markProjectBound(this);
                bound = true;
            }
            writeProjectDiag(
                bound ? "STABLE_PROJECT_CONTEXT" : "STALE_PROJECT_CONTEXT_IGNORED",
                "project=" + ChatGptB1RunStore.REQUIRED_PROJECT
                    + "; autoNav=" + autoNavigationProof
                    + "; samples=" + projectContextSamples
                    + "; stableMs=" + stableMs
            );
            resetProjectContextCandidate();
        }
    }

    private void maybeActivateStandaloneFallback(AccessibilityNodeInfo root) {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.projectBound || !"WAITING_PROJECT".equals(run.state) || root == null) return;
        // Core tasks require the exact pinned Project. A standalone chat is not an accepted fallback.
        if (!ChatGptB1Policy.canUseStandaloneFallbackForTask(run.taskId)) return;
        if (!ChatGptB1Policy.shouldUseStandaloneFallback(run.startedElapsedAt, SystemClock.elapsedRealtime())) return;

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long newChatAt = prefs.getLong(KEY_STANDALONE_NEW_CHAT_AT, 0L);
        if (newChatAt < run.startedAt) {
            AccessibilityNodeInfo newChat = ChatGptB1Automation.findNewChatControl(root);
            if (newChat == null) {
                writeProjectDiag("STANDALONE_WAIT_NEW_CHAT", "newChatControl=false");
                return;
            }
            boolean clicked = newChat.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            writeProjectDiag(clicked ? "STANDALONE_NEW_CHAT_CLICK" : "STANDALONE_NEW_CHAT_CLICK_FAILED", "semanticNewChat=true");
            if (clicked) {
                prefs.edit().putLong(KEY_STANDALONE_NEW_CHAT_AT, System.currentTimeMillis()).apply();
                projectNavigationNextActionAt = System.currentTimeMillis() + ChatGptB1Policy.PROJECT_NAV_STEP_MS;
            }
            return;
        }

        if (System.currentTimeMillis() - newChatAt < 1000L) return;
        AccessibilityNodeInfo composer = ChatGptB1Automation.findComposerInput(root);
        String composerText = composer == null || composer.getText() == null ? "" : composer.getText().toString().trim();
        if (composer == null || !composerText.isEmpty()) {
            writeProjectDiag("STANDALONE_WAIT_COMPOSER", "composer=" + (composer != null) + "; empty=" + composerText.isEmpty());
            return;
        }

        writeProjectDiag("STANDALONE_FALLBACK_READY", "freshNewChat=true; composer=true; empty=true");
        ChatGptB1RunStore.markStandaloneFallbackReady(this);
        resetProjectContextCandidate();
    }

    private void resetProjectContextCandidate() {
        projectContextSamples = 0;
        projectContextFirstSeenAt = 0L;
        projectContextCandidateRunId = "";
        projectContextCandidateTaskId = "";
        projectContextCandidateCycle = 0;
    }

    private void writeProjectDiag(String mode, String detail) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_PROJECT_GATE_MODE, mode)
            .putString(KEY_PROJECT_GATE_DIAG, compactDiag(detail))
            .putLong(KEY_PROJECT_GATE_AT, System.currentTimeMillis())
            .apply();
    }

    private static String compactDiag(String value) {
        if (value == null) return "";
        String normalized = value.replace('\n', ' ').replace('\r', ' ').trim();
        return normalized.length() <= 280 ? normalized : normalized.substring(0, 280);
    }

    private void ensureB1Ticker() {
        if (b1TickScheduled) return;
        b1TickScheduled = true;
        recoveryHandler.postDelayed(b1TickRunnable, 400L);
    }

    private void scheduleB1RecoveryIfNeeded() {
        if (WorkerRuntimeControl.isPaused(this)) return;
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.recoveryCount >= MAX_B1_RECOVERIES) return;
        // The 750ms ticker must NOT push a pending 2500ms recovery forever.
        // Only replace the pending timer when the actual run identity changes.
        if (recoveryPending
            && recoveryScheduledStartedAt == run.startedAt
            && ChatGptB1Policy.isSameProjectContextCandidate(
                recoveryScheduledRunId, recoveryScheduledTaskId, recoveryScheduledCycle,
                run.runId, run.taskId, run.cycle
            )) return;
        recoveryHandler.removeCallbacks(recoveryRunnable);
        recoveryScheduledRunId = run.runId;
        recoveryScheduledTaskId = run.taskId;
        recoveryScheduledCycle = run.cycle;
        recoveryScheduledStartedAt = run.startedAt;
        recoveryPending = true;
        recoveryHandler.postDelayed(recoveryRunnable, 2500L);
    }

    private void writeProbe(boolean rootAvailable, int nodes, int editable, int clickable) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ROOT_AVAILABLE, rootAvailable)
            .putInt(KEY_NODE_COUNT, nodes)
            .putInt(KEY_EDITABLE_COUNT, editable)
            .putInt(KEY_CLICKABLE_COUNT, clickable)
            .apply();
    }

    private static boolean isPilotProvider(String packageName) {
        return CHATGPT_PACKAGE.equals(packageName)
            || GEMINI_PACKAGE.equals(packageName)
            || GOOGLE_APP_PACKAGE.equals(packageName);
    }

    @Override
    public void onInterrupt() {
        recoveryHandler.removeCallbacks(recoveryRunnable);
        recoveryPending = false;
        recoveryHandler.removeCallbacks(b1TickRunnable);
        b1TickScheduled = false;
    }

    public boolean semanticTreeAvailable() {
        return getRootInActiveWindow() != null;
    }
}