package ai.tigeriq.worker;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
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

    private static final int MAX_PROBE_NODES = 500;
    private static final String CHATGPT_PACKAGE = "com.openai.chatgpt";
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final String GOOGLE_APP_PACKAGE = "com.google.android.googlequicksearchbox";
    private static final int MAX_B1_RECOVERIES = 2;
    private final Handler recoveryHandler = new Handler(Looper.getMainLooper());
    private boolean b1TickScheduled = false;
    private int projectContextSamples = 0;
    private long projectContextFirstSeenAt = 0L;
    private String projectContextRunId = "";

    private final Runnable b1TickRunnable = new Runnable() {
        @Override
        public void run() {
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(AccessibilityBridgeService.this);
            if (!run.active()) {
                clearProjectContextCandidate();
                b1TickScheduled = false;
                return;
            }
            AccessibilityNodeInfo current = getRootInActiveWindow();
            CharSequence pkg = current == null ? null : current.getPackageName();
            if (pkg != null && CHATGPT_PACKAGE.equals(pkg.toString())) {
                maybeBindProjectFromStableContext(current);
                ChatGptB1Automation.drive(AccessibilityBridgeService.this, current);
            } else {
                clearProjectContextCandidate();
                scheduleB1RecoveryIfNeeded();
            }
            recoveryHandler.postDelayed(this, 750L);
        }
    };

    private final Runnable recoveryRunnable = () -> {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.recoveryCount >= MAX_B1_RECOVERIES) return;
        AccessibilityNodeInfo current = getRootInActiveWindow();
        CharSequence pkg = current == null ? null : current.getPackageName();
        if (pkg != null && CHATGPT_PACKAGE.equals(pkg.toString())) return;
        Intent launch = getPackageManager().getLaunchIntentForPackage(CHATGPT_PACKAGE);
        if (launch == null) {
            ChatGptB1RunStore.fail(this, "CHATGPT_NATIVE_APP_NOT_FOUND");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ChatGptB1RunStore.markRecovery(this);
        startActivity(launch);
    };

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        CharSequence packageName = event == null ? null : event.getPackageName();
        if (packageName == null) return;

        String value = packageName.toString();

        // Reset Project stability before any early return whenever foreground evidence leaves
        // ChatGPT. The only exception is the active IME while ChatGPT still owns the root.
        if (!CHATGPT_PACKAGE.equals(value)) {
            AccessibilityNodeInfo activeRoot = getRootInActiveWindow();
            CharSequence activeRootPackage = activeRoot == null ? null : activeRoot.getPackageName();
            boolean chatGptStillOwnsRoot = activeRootPackage != null
                && CHATGPT_PACKAGE.equals(activeRootPackage.toString());
            boolean activeImeEvent = isActiveInputMethodPackage(value);
            if (!activeImeEvent || !chatGptStillOwnsRoot) {
                clearProjectContextCandidate();
            }
        }

        if (getPackageName().equals(value)) return;

        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_LAST_PACKAGE, value)
            .putLong(KEY_LAST_EVENT_AT, System.currentTimeMillis())
            .apply();

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
            maybeBindRequiredProject(event, root);
            maybeBindProjectFromStableContext(root);
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
        boolean clickProjectMatch = directLineageMatch || localClickableScopeMatch;
        boolean shouldBind = ChatGptB1Policy.shouldBindRequiredProject(
            run.active(),
            run.projectBound,
            run.state,
            true,
            true,
            clickProjectMatch
        );
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

        if (shouldBind) ChatGptB1RunStore.markProjectBound(this);
    }

    private void maybeBindProjectFromStableContext(AccessibilityNodeInfo root) {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.projectBound || !"WAITING_PROJECT".equals(run.state)) {
            clearProjectContextCandidate();
            return;
        }

        if (!run.runId.equals(projectContextRunId)) {
            resetProjectContextCandidate();
            projectContextRunId = run.runId;
        }

        boolean exactProject = root != null
            && ChatGptB1Automation.treeContainsExactLabel(root, ChatGptB1RunStore.REQUIRED_PROJECT);
        boolean projectTitleContext = root != null
            && ChatGptB1Automation.treeContainsExactProjectTitleSignal(
                root,
                ChatGptB1RunStore.REQUIRED_PROJECT,
                6
            );
        boolean composerReady = root != null && ChatGptB1Automation.findComposerInput(root) != null;

        if (!exactProject || !composerReady || !projectTitleContext) {
            if (projectContextSamples > 0 || exactProject) {
                writeProjectDiag(
                    "CONTEXT_WAIT",
                    "exactProject=" + exactProject
                        + "; titleContext=" + projectTitleContext
                        + "; composer=" + composerReady
                        + "; samples=" + projectContextSamples
                );
            }
            resetProjectContextCandidate();
            return;
        }

        long now = System.currentTimeMillis();
        if (projectContextSamples == 0) projectContextFirstSeenAt = now;
        projectContextSamples += 1;
        long stableMs = Math.max(0L, now - projectContextFirstSeenAt);

        writeProjectDiag(
            "CONTEXT_CANDIDATE",
            "exactProject=true; titleContext=true; composer=true"
                + "; samples=" + projectContextSamples
                + "; stableMs=" + stableMs
        );

        boolean shouldBind = ChatGptB1Policy.shouldBindRequiredProjectFromStableContext(
            run.active(),
            run.projectBound,
            run.state,
            true,
            exactProject,
            projectTitleContext,
            composerReady,
            projectContextSamples,
            stableMs
        );
        if (shouldBind) {
            writeProjectDiag(
                "STABLE_PROJECT_CONTEXT",
                "project=" + ChatGptB1RunStore.REQUIRED_PROJECT
                    + "; samples=" + projectContextSamples
                    + "; stableMs=" + stableMs
                    + "; runId=" + run.runId
            );
            ChatGptB1RunStore.markProjectBound(this);
            clearProjectContextCandidate();
        }
    }

    private void resetProjectContextCandidate() {
        projectContextSamples = 0;
        projectContextFirstSeenAt = 0L;
    }

    private void clearProjectContextCandidate() {
        resetProjectContextCandidate();
        projectContextRunId = "";
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
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || b1TickScheduled) return;
        b1TickScheduled = true;
        recoveryHandler.postDelayed(b1TickRunnable, 400L);
    }

    private void scheduleB1RecoveryIfNeeded() {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        if (!run.active() || run.recoveryCount >= MAX_B1_RECOVERIES) return;
        recoveryHandler.removeCallbacks(recoveryRunnable);
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

    private boolean isActiveInputMethodPackage(String packageName) {
        if (packageName == null || packageName.isEmpty()) return false;
        String component = android.provider.Settings.Secure.getString(
            getContentResolver(),
            android.provider.Settings.Secure.DEFAULT_INPUT_METHOD
        );
        if (component == null || component.isEmpty()) return false;
        int slash = component.indexOf('/');
        String imePackage = slash > 0 ? component.substring(0, slash) : component;
        return packageName.equals(imePackage);
    }

    private static boolean isPilotProvider(String packageName) {
        return CHATGPT_PACKAGE.equals(packageName)
            || GEMINI_PACKAGE.equals(packageName)
            || GOOGLE_APP_PACKAGE.equals(packageName);
    }

    @Override
    public void onInterrupt() {
        recoveryHandler.removeCallbacks(recoveryRunnable);
        recoveryHandler.removeCallbacks(b1TickRunnable);
        clearProjectContextCandidate();
        b1TickScheduled = false;
    }

    public boolean semanticTreeAvailable() {
        return getRootInActiveWindow() != null;
    }
}
