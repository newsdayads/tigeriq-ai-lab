package ai.tigeriq.worker;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class AccessibilityBridgeService extends AccessibilityService {
    public static final String PREFS = "tigeriq-accessibility-pilot";
    public static final String KEY_LAST_PACKAGE = "lastPackage";
    public static final String KEY_LAST_EVENT_AT = "lastEventAt";
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";

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
            if (LocalTaskStore.QUEUED.equals(task.state)) {
                AccessibilityNodeInfo input = findEditable(root);
                if (input == null) return;
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, task.prompt);
                if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return;
                LocalTaskStore.updateState(this, LocalTaskStore.INPUT_SET);
                task = LocalTaskStore.load(this);
            }

            if (LocalTaskStore.INPUT_SET.equals(task.state)) {
                AccessibilityNodeInfo send = findSendControl(root);
                if (send == null) return;
                if (!clickNodeOrParent(send)) return;
                LocalTaskStore.updateState(this, LocalTaskStore.SUBMITTED);
                return;
            }

            if (LocalTaskStore.SUBMITTED.equals(task.state)) {
                long age = System.currentTimeMillis() - task.updatedAt;
                if (age < 5000L) return;
                if (!hasCompletionMarker(root)) return;
                String result = extractLikelyResponse(root, task.prompt);
                if (result.length() >= 40) LocalTaskStore.complete(this, result);
            }
        } catch (Exception error) {
            LocalTaskStore.fail(this, "UI_CHANGED");
        }
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            if (node.isVisibleToUser() && node.isEnabled() && node.isEditable()) return node;
            CharSequence klass = node.getClassName();
            if (node.isVisibleToUser() && node.isEnabled() && klass != null && klass.toString().toLowerCase(Locale.ROOT).contains("edittext")) return node;
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

    private boolean hasCompletionMarker(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            String joined = normalized(node.getText()) + " " + normalized(node.getContentDescription()) + " " + normalized(node.getViewIdResourceName());
            if (containsAny(joined,
                "copy", "sao chép", "share", "chia sẻ", "good response", "bad response",
                "listen", "nghe", "regenerate", "tạo lại")) return true;
            addChildren(queue, node);
        }
        return false;
    }

    private String extractLikelyResponse(AccessibilityNodeInfo root, String prompt) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        List<String> texts = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        queue.add(root);
        String normalizedPrompt = prompt == null ? "" : prompt.trim();

        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            CharSequence text = node.getText();
            if (text != null) {
                String candidate = text.toString().trim();
                if (isUsefulResultText(candidate, normalizedPrompt) && seen.add(candidate)) texts.add(candidate);
            }
            addChildren(queue, node);
        }

        StringBuilder out = new StringBuilder();
        for (String candidate : texts) {
            if (out.length() > 0) out.append("\n\n");
            out.append(candidate);
            if (out.length() >= 6000) break;
        }
        if (out.length() > 6000) out.setLength(6000);
        return out.toString().trim();
    }

    private boolean isUsefulResultText(String candidate, String prompt) {
        if (TextUtils.isEmpty(candidate) || candidate.length() < 20) return false;
        if (!TextUtils.isEmpty(prompt) && candidate.equals(prompt)) return false;
        String n = candidate.toLowerCase(Locale.ROOT);
        if (containsAny(n,
            "gemini", "new chat", "cuộc trò chuyện mới", "send", "gửi", "copy", "sao chép",
            "share", "chia sẻ", "listen", "nghe", "good response", "bad response",
            "google", "menu", "history", "lịch sử")) return false;
        return true;
    }

    private boolean clickNodeOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = node;
        for (int i = 0; i < 4 && current != null; i++) {
            if (current.isClickable() && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            current = current.getParent();
        }
        return false;
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
