package ai.tigeriq.worker;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Bounded semantic Gemini adapter for phone-first local tasks. */
public final class AccessibilityBridgeService extends AccessibilityService {
    public static final String PREFS = "tigeriq-accessibility-pilot";
    public static final String KEY_LAST_PACKAGE = "lastPackage";
    public static final String KEY_LAST_EVENT_AT = "lastEventAt";
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final long INPUT_DISCOVERY_TIMEOUT_MS = 15_000L;
    private static final long SEND_DISCOVERY_TIMEOUT_MS = 12_000L;

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

        if (!GEMINI_PACKAGE.equals(value)) return;
        runGeminiAdapter();
    }

    private void runGeminiAdapter() {
        LocalTaskStore.Snapshot task = LocalTaskStore.load(this);
        if (!task.active()) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        try {
            long age = System.currentTimeMillis() - task.updatedAt;
            String screen = collectScreenText(root);
            String failure = GeminiTaskPolicy.immediateFailure(screen, task.state, age);
            if (!failure.isEmpty()) {
                failAndReturn(failure);
                return;
            }

            if (LocalTaskStore.QUEUED.equals(task.state)) {
                AccessibilityNodeInfo input = findEditable(root);
                if (input == null) {
                    if (age > INPUT_DISCOVERY_TIMEOUT_MS) failAndReturn("UI_CHANGED");
                    return;
                }
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, task.prompt);
                if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                    if (age > INPUT_DISCOVERY_TIMEOUT_MS) failAndReturn("UI_CHANGED");
                    return;
                }
                LocalTaskStore.updateState(this, LocalTaskStore.INPUT_SET);
                task = LocalTaskStore.load(this);
            }

            if (LocalTaskStore.INPUT_SET.equals(task.state)) {
                AccessibilityNodeInfo send = findSendControl(root);
                if (send == null) {
                    if (System.currentTimeMillis() - task.updatedAt > SEND_DISCOVERY_TIMEOUT_MS) failAndReturn("UI_CHANGED");
                    return;
                }

                // Capture only privacy-safe hashes of the pre-submit screen. Raw prior chat content is never persisted.
                List<String> beforeSubmitTexts = collectOrderedTexts(root);
                Set<String> baselineHashes = GeminiTaskPolicy.baselineHashes(beforeSubmitTexts, task.prompt);
                int baselineMarkerCount = countCompletionMarkers(root);

                if (!clickNodeOrParent(send)) {
                    if (System.currentTimeMillis() - task.updatedAt > SEND_DISCOVERY_TIMEOUT_MS) failAndReturn("UI_CHANGED");
                    return;
                }
                LocalTaskStore.markSubmitted(this, baselineHashes, baselineMarkerCount);
                return;
            }

            if (LocalTaskStore.SUBMITTED.equals(task.state)) {
                if (!GeminiTaskPolicy.resumableSubmitted(task.state, task.boundaryCaptured)) {
                    failAndReturn("UI_CHANGED");
                    return;
                }

                long submittedAge = System.currentTimeMillis() - task.updatedAt;
                String submittedFailure = GeminiTaskPolicy.immediateFailure(screen, task.state, submittedAge);
                if (!submittedFailure.isEmpty()) {
                    failAndReturn(submittedFailure);
                    return;
                }

                List<String> currentTexts = collectOrderedTexts(root);
                List<String> currentTurn = GeminiTaskPolicy.currentTurnCandidates(currentTexts, task.prompt, task.baselineHashes);
                int currentMarkerCount = countCompletionMarkers(root);
                if (!GeminiTaskPolicy.completionReady(submittedAge, task.baselineMarkerCount, currentMarkerCount, currentTurn)) return;

                String result = GeminiTaskPolicy.joinBounded(currentTurn, 6000);
                if (result.length() >= 40) {
                    LocalTaskStore.complete(this, result);
                    returnToTigerIQ();
                }
            }
        } catch (Exception error) {
            failAndReturn("UI_CHANGED");
        }
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            if (node.isVisibleToUser() && node.isEnabled() && node.isEditable()) return node;
            CharSequence klass = node.getClassName();
            if (node.isVisibleToUser() && node.isEnabled() && klass != null
                && klass.toString().toLowerCase(Locale.ROOT).contains("edittext")) return node;
            addChildren(queue, node);
        }
        return null;
    }

    private AccessibilityNodeInfo findSendControl(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            String joined = normalized(node.getText()) + " " + normalized(node.getContentDescription()) + " " + normalized(node.getViewIdResourceName());
            if (containsAny(joined, "send", "gửi", "submit", "send_message", "send button")) return node;
            addChildren(queue, node);
        }
        return null;
    }

    private int countCompletionMarkers(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int count = 0;
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            String joined = normalized(node.getText()) + " " + normalized(node.getContentDescription()) + " " + normalized(node.getViewIdResourceName());
            if (containsAny(joined,
                "copy", "sao chép", "share", "chia sẻ", "good response", "bad response",
                "listen", "nghe", "regenerate", "tạo lại")) count++;
            addChildren(queue, node);
        }
        return count;
    }

    private String collectScreenText(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        StringBuilder out = new StringBuilder();
        queue.add(root);
        while (!queue.isEmpty() && out.length() < 8000) {
            AccessibilityNodeInfo node = queue.removeFirst();
            CharSequence text = node.getText();
            CharSequence desc = node.getContentDescription();
            if (text != null) out.append(' ').append(text);
            if (desc != null) out.append(' ').append(desc);
            addChildren(queue, node);
        }
        return out.toString().toLowerCase(Locale.ROOT);
    }

    private List<String> collectOrderedTexts(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        ArrayList<String> texts = new ArrayList<>();
        queue.add(root);
        while (!queue.isEmpty() && texts.size() < 500) {
            AccessibilityNodeInfo node = queue.removeFirst();
            CharSequence text = node.getText();
            if (text != null) {
                String value = text.toString().trim();
                if (!value.isEmpty()) texts.add(value);
            }
            addChildren(queue, node);
        }
        return texts;
    }

    private boolean clickNodeOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = node;
        for (int i = 0; i < 4 && current != null; i++) {
            if (current.isClickable() && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            current = current.getParent();
        }
        return false;
    }

    private void failAndReturn(String reason) {
        LocalTaskStore.fail(this, reason);
        returnToTigerIQ();
    }

    private void returnToTigerIQ() {
        try {
            Intent intent = new Intent(this, HomeActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        } catch (Exception ignored) {
            performGlobalAction(GLOBAL_ACTION_BACK);
        }
    }

    private void addChildren(ArrayDeque<AccessibilityNodeInfo> queue, AccessibilityNodeInfo node) {
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) queue.addLast(child);
        }
    }

    private String normalized(CharSequence value) {
        return value == null ? "" : value.toString().trim().toLowerCase(Locale.ROOT);
    }

    private boolean containsAny(String haystack, String... needles) {
        for (String needle : needles) if (haystack.contains(needle)) return true;
        return false;
    }

    @Override
    public void onInterrupt() {
        LocalTaskStore.Snapshot task = LocalTaskStore.load(this);
        if (task.active()) LocalTaskStore.fail(this, "ACCESSIBILITY_DISABLED");
    }

    public boolean semanticTreeAvailable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root != null;
    }
}
