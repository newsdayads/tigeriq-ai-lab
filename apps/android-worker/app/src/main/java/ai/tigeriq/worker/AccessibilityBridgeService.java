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

    private static final int MAX_PROBE_NODES = 500;
    private static final String CHATGPT_PACKAGE = "com.openai.chatgpt";
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final String GOOGLE_APP_PACKAGE = "com.google.android.googlequicksearchbox";
    private static final int MAX_B1_RECOVERIES = 2;
    private final Handler recoveryHandler = new Handler(Looper.getMainLooper());
    private boolean b1TickScheduled = false;

    private final Runnable b1TickRunnable = new Runnable() {
        @Override
        public void run() {
            ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(AccessibilityBridgeService.this);
            if (!run.active()) {
                b1TickScheduled = false;
                return;
            }
            AccessibilityNodeInfo current = getRootInActiveWindow();
            CharSequence pkg = current == null ? null : current.getPackageName();
            if (pkg != null && CHATGPT_PACKAGE.equals(pkg.toString())) {
                ChatGptB1Automation.drive(AccessibilityBridgeService.this, current);
            } else {
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
            maybeBindRequiredProject(event);
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

    private void maybeBindRequiredProject(AccessibilityEvent event) {
        ChatGptB1RunStore.Snapshot run = ChatGptB1RunStore.read(this);
        AccessibilityNodeInfo source = event == null ? null : event.getSource();
        boolean exactProjectLabelSeen = source != null
            && ChatGptB1Automation.treeContainsExactLabel(source, ChatGptB1RunStore.REQUIRED_PROJECT);
        boolean shouldBind = ChatGptB1Policy.shouldBindRequiredProject(
            run.active(),
            run.projectBound,
            run.state,
            event != null && CHATGPT_PACKAGE.equals(String.valueOf(event.getPackageName())),
            event != null && event.getEventType() == AccessibilityEvent.TYPE_VIEW_CLICKED,
            exactProjectLabelSeen
        );
        if (shouldBind) ChatGptB1RunStore.markProjectBound(this);
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

    private static boolean isPilotProvider(String packageName) {
        return CHATGPT_PACKAGE.equals(packageName)
            || GEMINI_PACKAGE.equals(packageName)
            || GOOGLE_APP_PACKAGE.equals(packageName);
    }

    @Override
    public void onInterrupt() {
        recoveryHandler.removeCallbacks(recoveryRunnable);
        recoveryHandler.removeCallbacks(b1TickRunnable);
        b1TickScheduled = false;
    }

    public boolean semanticTreeAvailable() {
        return getRootInActiveWindow() != null;
    }
}
