package ai.tigeriq.worker;

import android.os.Build;
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
        if (!s.projectBound) return;

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

        AccessibilityNodeInfo send = findSendControl(root, input);
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

    public static AccessibilityNodeInfo findSendControl(
        AccessibilityNodeInfo root,
        AccessibilityNodeInfo composerInput
    ) {
        if (root == null) return null;

        // Primary path: the semantic label may live on an icon/child while the action is on a parent.
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser()) continue;
            String label = searchable(node);
            if (!isSendLabel(label)) continue;
            AccessibilityNodeInfo clickable = nearestClickable(node, 4);
            if (clickable != null && clickable.isEnabled() && !isForbiddenControl(searchable(clickable))) {
                return clickable;
            }
        }

        // Safe semantic fallback: stay inside the smallest composer subtree and only pick a
        // unique icon-like clickable control after excluding known non-send controls.
        AccessibilityNodeInfo scope = composerInput == null ? null : composerInput.getParent();
        for (int depth = 0; scope != null && depth < 4; depth++) {
            AccessibilityNodeInfo candidate = uniqueComposerAction(scope, composerInput);
            if (candidate != null) return candidate;
            scope = scope.getParent();
        }
        return null;
    }

    private static AccessibilityNodeInfo nearestClickable(AccessibilityNodeInfo node, int maxParents) {
        AccessibilityNodeInfo current = node;
        for (int depth = 0; current != null && depth <= maxParents; depth++) {
            if (current.isVisibleToUser() && current.isEnabled() && current.isClickable()) return current;
            current = current.getParent();
        }
        return null;
    }

    private static AccessibilityNodeInfo uniqueComposerAction(
        AccessibilityNodeInfo scope,
        AccessibilityNodeInfo composerInput
    ) {
        AccessibilityNodeInfo best = null;
        int bestScore = Integer.MIN_VALUE;
        int secondScore = Integer.MIN_VALUE;

        for (AccessibilityNodeInfo node : nodes(scope)) {
            if (!node.isVisibleToUser() || !node.isEnabled() || !node.isClickable()) continue;
            if (sameNode(node, composerInput) || node.isEditable()) continue;

            String label = searchable(node);
            if (isForbiddenControl(label)) continue;

            if (isSendLabel(label)) {
                AccessibilityNodeInfo clickable = nearestClickable(node, 2);
                if (clickable != null) return clickable;
            }

            int score = 0;
            String className = normalize(String.valueOf(node.getClassName()));
            String text = text(node.getText());
            String description = text(node.getContentDescription());
            String viewId = text(node.getViewIdResourceName());

            if (className.contains("button") || className.contains("imagebutton")) score += 50;
            if (text.isEmpty()) score += 15;
            if (description.isEmpty()) score += 15;
            if (viewId.isEmpty()) score += 10;
            if (node.getChildCount() <= 2) score += 10;
            if (containsAny(label, "arrow", "up", "mũi tên")) score += 25;

            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                best = node;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }

        // Do not guess when several controls look equally plausible.
        return best != null && bestScore >= 70 && bestScore - secondScore >= 20 ? best : null;
    }

    private static boolean isSendLabel(String label) {
        return containsAny(
            label,
            "send", "gửi", "submit", "send message", "send prompt",
            "composer_send", "send_button", "arrow up", "up arrow", "mũi tên lên"
        );
    }

    private static boolean isForbiddenControl(String label) {
        return containsAny(
            label,
            "microphone", "mic", "voice", "camera", "photo", "attach", "đính kèm",
            "gọi thoại", "call", "plus", "add", "expand", "fullscreen", "tools",
            "search", "browse", "web", "settings", "menu", "more"
        );
    }

    private static boolean sameNode(AccessibilityNodeInfo left, AccessibilityNodeInfo right) {
        return left != null && right != null && left.equals(right);
    }

    public static boolean treeContains(AccessibilityNodeInfo root, String needle) {
        String wanted = normalize(needle);
        if (wanted.isEmpty()) return false;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (searchable(node).contains(wanted)) return true;
        }
        return false;
    }

    public static boolean treeContainsExactLabel(AccessibilityNodeInfo root, String label) {
        String wanted = normalize(label);
        if (wanted.isEmpty()) return false;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (wanted.equals(normalize(text(node.getText())))
                || wanted.equals(normalize(text(node.getContentDescription())))
                || wanted.equals(normalize(text(node.getHintText())))) {
                return true;
            }
        }
        return false;
    }

    public static boolean treeContainsExactProjectTitleSignal(
        AccessibilityNodeInfo root,
        String label,
        int maxStructuralParents
    ) {
        String wanted = normalize(label);
        if (root == null || wanted.isEmpty()) return false;

        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !nodeHasExactLabel(node, wanted)) continue;
            if (node.isClickable() || node.isEditable() || node.isScrollable()) continue;

            boolean blockedByInteractiveOrScrollableAncestor = false;
            boolean titleSemantic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && node.isHeading();
            boolean projectSemantic = false;
            AccessibilityNodeInfo current = node;
            int depth = 0;

            while (current != null) {
                if (current.isClickable() || current.isEditable() || current.isScrollable()) {
                    blockedByInteractiveOrScrollableAncestor = true;
                    break;
                }
                if (depth <= maxStructuralParents) {
                    String structural = structuralSearchable(current);
                    if (containsAny(structural, "title", "header", "toolbar", "appbar", "app bar", "top bar")) {
                        titleSemantic = true;
                    }
                    if (containsAny(structural, "project_title", "project title", "project_header", "project header", "project_toolbar", "project toolbar")) {
                        projectSemantic = true;
                    }
                }
                current = current.getParent();
                depth += 1;
            }

            if (!blockedByInteractiveOrScrollableAncestor && projectSemantic && titleSemantic) return true;
        }
        return false;
    }

    private static String structuralSearchable(AccessibilityNodeInfo node) {
        return normalize(
            text(node.getViewIdResourceName()) + " "
                + String.valueOf(node.getClassName()) + " "
                + text(node.getContentDescription()) + " "
                + text(node.getHintText())
        );
    }

    public static boolean nodeOrAncestorContainsLabel(
        AccessibilityNodeInfo source,
        String label,
        int maxParents
    ) {
        String wanted = normalize(label);
        if (source == null || wanted.isEmpty()) return false;
        AccessibilityNodeInfo current = source;
        for (int depth = 0; current != null && depth <= maxParents; depth++) {
            // Direct lineage only: inspect the clicked node and each ancestor's own semantic fields.
            // Never scan an ancestor subtree here; that could match the required Project in a sibling branch.
            if (searchable(current).contains(wanted)) return true;
            current = current.getParent();
        }
        return false;
    }

    public static boolean localizedClickableAncestorContainsExactLabel(
        AccessibilityNodeInfo source,
        String label,
        int maxParents,
        int maxNodes
    ) {
        String wanted = normalize(label);
        if (source == null || wanted.isEmpty() || maxNodes < 1) return false;

        AccessibilityNodeInfo current = source;
        for (int depth = 0; current != null && depth <= maxParents; depth++) {
            if (current.isVisibleToUser() && current.isEnabled() && current.isClickable()) {
                // Stop at the nearest clickable scope. Never skip a clicked control to match
                // the required Project in a broader clickable ancestor.
                return boundedSubtreeContainsExactLabel(current, wanted, maxNodes);
            }
            current = current.getParent();
        }
        return false;
    }

    private static boolean boundedSubtreeContainsExactLabel(
        AccessibilityNodeInfo root,
        String wanted,
        int maxNodes
    ) {
        Deque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int seen = 0;
        boolean found = false;
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            seen += 1;
            if (seen > maxNodes) return false;
            if (nodeHasExactLabel(node, wanted)) found = true;
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.addLast(child);
            }
        }
        return found;
    }

    private static boolean nodeHasExactLabel(AccessibilityNodeInfo node, String wanted) {
        return wanted.equals(normalize(text(node.getText())))
            || wanted.equals(normalize(text(node.getContentDescription())))
            || wanted.equals(normalize(text(node.getHintText())));
    }

    public static String describeNodeLineage(AccessibilityNodeInfo source, int maxParents) {
        if (source == null) return "source=null";
        StringBuilder out = new StringBuilder();
        AccessibilityNodeInfo current = source;
        for (int depth = 0; current != null && depth <= maxParents; depth++) {
            if (out.length() > 0) out.append(" <- ");
            String label = searchable(current);
            if (label.length() > 100) label = label.substring(0, 100);
            out.append(depth).append(':').append(label.isEmpty() ? "(empty)" : label);
            current = current.getParent();
        }
        return out.toString();
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
