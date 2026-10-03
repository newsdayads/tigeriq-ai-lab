package ai.tigeriq.worker;

import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;

/** Semantic-only ChatGPT adapter for approved B1 pilot. No coordinate taps or gestures. */
public final class ChatGptB1Automation {
    private static final long INPUT_TIMEOUT_MS = 20_000L;
    private static final long RESPONSE_TIMEOUT_MS = 90_000L;
    private static final int MAX_NODES = 600;

    private ChatGptB1Automation() {}

    public static void drive(AccessibilityBridgeService service, AccessibilityNodeInfo root) {
        ChatGptB1RunStore.Snapshot s = ChatGptB1RunStore.read(service);
        if (!s.active()) return;

        long now = System.currentTimeMillis();
        if (now < s.nextActionAt) return;

        if ("WAITING_AI".equals(s.state)) {
            if (treeContains(root, ChatGptB1RunStore.expectedToken(s))) {
                ChatGptB1RunStore.completeCurrentCycle(service);
                return;
            }
            if (treeContainsAny(root, "stop", "dừng", "stop generating", "đang trả lời")) {
                ChatGptB1RunStore.markBusySeen(service);
            }
            if (treeContainsAny(root, "something went wrong", "try again", "đã xảy ra lỗi", "thử lại")) {
                ChatGptB1RunStore.fail(service, "PROVIDER_ERROR_VISIBLE");
                return;
            }
            if (s.sentAt > 0 && now - s.sentAt > RESPONSE_TIMEOUT_MS) {
                ChatGptB1RunStore.fail(service, "RESPONSE_TIMEOUT");
            }
            return;
        }

        if (s.cycleStartedAt > 0 && now - s.cycleStartedAt > INPUT_TIMEOUT_MS) {
            ChatGptB1RunStore.fail(service, "INPUT_NOT_READY_TIMEOUT");
            return;
        }

        AccessibilityNodeInfo input = findComposerInput(root);
        if (input == null) {
            ChatGptB1RunStore.markVerifying(service);
            return;
        }

        String prompt = ChatGptB1RunStore.prompt(s);
        String currentText = text(input.getText());
        if (!currentText.isEmpty() && !currentText.equals(prompt)) {
            ChatGptB1RunStore.fail(service, "INPUT_NOT_EMPTY_HUMAN_GATE");
            return;
        }

        if ("REQUESTED".equals(s.state) || "VERIFYING_CONTEXT".equals(s.state)) {
            input.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, prompt);
            boolean set = input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            if (!set) {
                ChatGptB1RunStore.fail(service, "ACTION_SET_TEXT_FAILED");
                return;
            }
            ChatGptB1RunStore.markInputReady(service);
            return;
        }

        if (!"INPUT_READY".equals(s.state)) return;
        if (s.sentCycle == s.cycle) return;

        AccessibilityNodeInfo send = findSendControl(root);
        if (send == null) {
            // Text has been set; wait for the provider to render its semantic send control.
            return;
        }

        boolean clicked = send.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        if (!clicked) {
            ChatGptB1RunStore.fail(service, "SEND_CLICK_FAILED");
            return;
        }
        ChatGptB1RunStore.markSentExactlyOnce(service);
    }

    public static AccessibilityNodeInfo findComposerInput(AccessibilityNodeInfo root) {
        if (root == null) return null;
        AccessibilityNodeInfo best = null;
        int bestScore = Integer.MIN_VALUE;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !node.isEditable()) continue;
            String label = searchable(node);
            int score = 10;
            if (containsAny(label, "composer", "prompt", "message", "chat input", "hỏi chatgpt", "ask chatgpt")) score += 100;
            if (node.isFocused()) score += 20;
            if (score > bestScore) {
                best = node;
                bestScore = score;
            }
        }
        return best;
    }

    public static AccessibilityNodeInfo findSendControl(AccessibilityNodeInfo root) {
        if (root == null) return null;
        AccessibilityNodeInfo best = null;
        int bestScore = Integer.MIN_VALUE;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !node.isClickable()) continue;
            String label = searchable(node);
            if (containsAny(label, "microphone", "mic", "voice", "camera", "photo", "attach", "đính kèm", "gọi thoại", "call")) continue;
            int score = 0;
            if (containsAny(label, "send", "gửi", "submit", "composer_send", "send_button")) score += 120;
            if (label.contains("button")) score += 5;
            if (score > bestScore && score >= 100) {
                best = node;
                bestScore = score;
            }
        }
        return best;
    }

    public static boolean treeContains(AccessibilityNodeInfo root, String needle) {
        String wanted = normalize(needle);
        if (wanted.isEmpty()) return false;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (searchable(node).contains(wanted)) return true;
        }
        return false;
    }

    private static boolean treeContainsAny(AccessibilityNodeInfo root, String... needles) {
        for (AccessibilityNodeInfo node : nodes(root)) {
            String label = searchable(node);
            if (containsAny(label, needles)) return true;
        }
        return false;
    }

    private static Iterable<AccessibilityNodeInfo> nodes(AccessibilityNodeInfo root) {
        java.util.ArrayList<AccessibilityNodeInfo> out = new java.util.ArrayList<>();
        Deque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty() && out.size() < MAX_NODES) {
            AccessibilityNodeInfo node = queue.removeFirst();
            out.add(node);
            int childCount = node.getChildCount();
            for (int i = 0; i < childCount && out.size() + queue.size() < MAX_NODES; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.addLast(child);
            }
        }
        return out;
    }

    private static String searchable(AccessibilityNodeInfo node) {
        StringBuilder out = new StringBuilder();
        append(out, node.getText());
        append(out, node.getContentDescription());
        append(out, node.getHintText());
        append(out, node.getViewIdResourceName());
        append(out, node.getClassName());
        return normalize(out.toString());
    }

    private static void append(StringBuilder out, Object value) {
        if (value == null) return;
        if (out.length() > 0) out.append(' ');
        out.append(value);
    }

    private static boolean containsAny(String haystack, String... needles) {
        for (String needle : needles) {
            if (haystack.contains(normalize(needle))) return true;
        }
        return false;
    }

    private static String text(CharSequence value) {
        return value == null ? "" : value.toString().trim();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).trim();
    }
}
