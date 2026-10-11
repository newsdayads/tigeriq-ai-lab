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
        if (!s.projectBound) return;
        // A persisted standalone fallback must not send a leased Core task into the wrong chat.
        if (!ChatGptB1Policy.canExecuteCoreTaskInProjectContext(s.taskId, s.projectMode)) {
            failObservedRun(service, s, "REQUIRED_PROJECT_CONTEXT_MISMATCH");
            return;
        }

        long now = System.currentTimeMillis();
        if (now < s.nextActionAt) return;

        if ("WAITING_AI".equals(s.state)) {
            boolean coreLease = s.taskId != null && !s.taskId.isEmpty();
            boolean generationInProgress = coreLease && treeContainsAny(
                root, "stop generating", "đang trả lời", "dừng tạo"
            );
            // Deadline and generation state must be checked BEFORE any token
            // recognition. Previously a late/streaming token could win the
            // race with the timeout check and be reported as Core COMPLETE.
            if (coreLease && !ChatGptB1Policy.canAcceptCoreReplyWithinWindow(
                s.sentAt, now, RESPONSE_TIMEOUT_MS, generationInProgress
            )) {
                if (s.sentAt <= 0L || now < s.sentAt) {
                    failObservedRun(service, s, "CORE_REPLY_CLOCK_OR_SEND_INVALID");
                } else if (now - s.sentAt > RESPONSE_TIMEOUT_MS) {
                    failObservedRun(service, s, "RESPONSE_TIMEOUT");
                } else {
                    markBusyObservedRun(service, s);
                }
                return;
            }
            String expectedToken = ChatGptB1RunStore.expectedToken(s);
            // A Core receipt requires the newly sent user prompt followed by a
            // structurally tagged assistant message. Broad token scans are
            // legacy manual-B1 only; a visible token is never Core proof.
            String responseText = coreLease
                ? coreResponseTextContaining(
                    root, expectedToken, ChatGptB1RunStore.prompt(s),
                    s.sentAt > 0 && s.sentCycle == s.cycle
                )
                : responseTextContaining(root, expectedToken, ChatGptB1RunStore.prompt(s));
            if (!responseText.isEmpty()) {
                // Another ChatGPT conversation can display the same token after
                // navigation. Never credit it to a Core-lease Project run.
                boolean liveProjectTitle = treeContainsExactLabelOutsideClickableNavigation(
                    root, ChatGptB1Policy.REQUIRED_PROJECT, 3
                );
                if (!ChatGptB1Policy.canAcceptResponseInLiveProjectContext(
                    s.taskId, s.projectMode, s.projectBound, liveProjectTitle
                )) {
                    failObservedRun(service, s, "PROJECT_CONTEXT_LOST_BEFORE_RESPONSE_ACCEPTANCE");
                    return;
                }
                if (coreLease) {
                    // The UI scan may span a Core lease replacement. Only the
                    // still-current durable task may store this reply.
                    ChatGptB1RunStore.completeCoreReplyIfCurrent(
                        service, s.runId, s.taskId, s.cycle,
                        expectedToken, responseText
                    );
                } else {
                    ChatGptB1RunStore.completeManualReplyIfCurrent(
                        service, s.runId, s.cycle, s.startedAt,
                        expectedToken, responseText
                    );
                }
                return;
            }
            if (treeContainsAny(root, "stop", "dừng", "stop generating", "đang trả lời")) {
                markBusyObservedRun(service, s);
            }
            if (treeContainsAny(root, "something went wrong", "try again", "đã xảy ra lỗi", "thử lại")) {
                failObservedRun(service, s, "PROVIDER_ERROR_VISIBLE");
                return;
            }
            if (s.sentAt > 0 && now - s.sentAt > RESPONSE_TIMEOUT_MS) {
                failObservedRun(service, s, "RESPONSE_TIMEOUT");
            }
            return;
        }

        if (s.cycleStartedAt > 0 && now - s.cycleStartedAt > INPUT_TIMEOUT_MS) {
            failObservedRun(service, s, "INPUT_NOT_READY_TIMEOUT");
            return;
        }

        AccessibilityNodeInfo input = findComposerInput(root);
        if (input == null) {
            markVerifyingObservedRun(service, s);
            return;
        }

        // The user/app may navigate to another chat after the original Project
        // binding. Revalidate the non-navigation Project title on the LIVE tree
        // before ANY set-text or send click for a Core-leased task.
        boolean liveProjectTitle = treeContainsExactLabelOutsideClickableNavigation(
            root, ChatGptB1Policy.REQUIRED_PROJECT, 3
        );
        if (!ChatGptB1Policy.canMutateComposerInLiveProjectContext(
            s.taskId, s.projectMode, s.projectBound, liveProjectTitle, true
        )) {
            failObservedRun(service, s, "PROJECT_CONTEXT_LOST_BEFORE_COMPOSER_MUTATION");
            return;
        }

        String prompt = ChatGptB1RunStore.prompt(s);
        String currentText = text(input.getText());
        if (!currentText.isEmpty() && !currentText.equals(prompt)) {
            failObservedRun(service, s, "INPUT_NOT_EMPTY_HUMAN_GATE");
            return;
        }

        if ("REQUESTED".equals(s.state) || "VERIFYING_CONTEXT".equals(s.state)) {
            // UI scanning and focus can outlive the original Core lease.
            // Narrow this race both before focus and immediately before the
            // native ACTION_SET_TEXT; do not fill a replacement task's composer.
            boolean coreMutation = s.taskId != null && !s.taskId.isEmpty();
            if (coreMutation
                ? !ChatGptB1RunStore.isCoreComposerMutationStillCurrent(
                    service, s.runId, s.taskId, s.cycle, prompt
                )
                : !ChatGptB1RunStore.isManualComposerMutationStillCurrent(
                    service, s.runId, s.cycle, s.startedAt, prompt
                )) return;
            input.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            if (coreMutation
                ? !ChatGptB1RunStore.isCoreComposerMutationStillCurrent(
                    service, s.runId, s.taskId, s.cycle, prompt
                )
                : !ChatGptB1RunStore.isManualComposerMutationStillCurrent(
                    service, s.runId, s.cycle, s.startedAt, prompt
                )) return;
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, prompt);
            boolean set = input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            if (!set) {
                failObservedRun(service, s, "ACTION_SET_TEXT_FAILED");
                return;
            }
            markInputReadyObservedRun(service, s);
            return;
        }

        if (!"INPUT_READY".equals(s.state)) return;
        if (s.sentCycle == s.cycle) return;

        // INPUT_READY is persisted after ACTION_SET_TEXT but the human or app
        // may clear/replace the composer during the fill-to-send cooldown.
        // For a Core lease, never claim the at-most-once send against a stale
        // snapshot without the EXACT live prompt still in the editable field.
        if (s.taskId != null && !s.taskId.isEmpty()
            && !ChatGptB1Policy.canSendCorePromptFromLiveComposer(
                s.state, prompt, currentText, input.isVisibleToUser(), input.isEditable()
            )) {
            failObservedRun(service, s, "CORE_COMPOSER_TEXT_LOST_BEFORE_SEND");
            return;
        }

        AccessibilityNodeInfo send = (s.taskId != null && !s.taskId.isEmpty())
            ? findTrustedCoreSendControl(root, input)
            : findSendControl(root, input);
        if (send == null) {
            // Text has been set; wait for the provider to render its semantic send control.
            return;
        }

        // Reject stale task transcripts BEFORE the irreversible send. A
        // previously visible matching user prompt or assistant token could
        // otherwise be misattributed to this Core lease after navigation.
        if (s.taskId != null && !s.taskId.isEmpty()
            && coreTranscriptAlreadyContainsTask(
                root, prompt, ChatGptB1RunStore.expectedToken(s)
            )) {
            failObservedRun(service, s, "CORE_RESPONSE_PROVENANCE_PREEXISTS");
            return;
        }

        // Commit the at-most-once send claim to disk before the irreversible
        // accessibility click. On crash/restart we can safely time out, not resend.
        boolean coreLeaseAtSend = s.taskId != null && !s.taskId.isEmpty();
        boolean sendClaimed = coreLeaseAtSend
            ? ChatGptB1RunStore.markSentExactlyOnce(
                service, s.runId, s.taskId, s.cycle, prompt
            )
            : ChatGptB1RunStore.markManualSentExactlyOnceIfCurrent(
                service, s.runId, s.cycle, s.startedAt, prompt
            );
        if (!sendClaimed) {
            // An old Accessibility callback cannot fail or click a newer run.
            // If the same Core lease remains active, INPUT_READY will time
            // out safely; the manual B1 error path stays unchanged.
            if (!coreLeaseAtSend) {
                failObservedRun(service, s, "SEND_CLAIM_PERSIST_FAILED");
            }
            return;
        }
        // Owner cancellation or task replacement can race with the durable
        // claim. A second identity check narrows the non-atomic UI-click window.
        if (coreLeaseAtSend
            ? !ChatGptB1RunStore.isCoreSendClaimStillCurrent(
                service, s.runId, s.taskId, s.cycle
            )
            : !ChatGptB1RunStore.isManualSendClaimStillCurrent(
                service, s.runId, s.cycle, s.startedAt
            )) return;
        boolean clicked = send.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        if (!clicked) {
            failObservedRun(service, s, "SEND_CLICK_FAILED");
        }
    }

    private static void failObservedRun(
        AccessibilityBridgeService service, ChatGptB1RunStore.Snapshot snapshot,
        String code
    ) {
        if (snapshot.taskId != null && !snapshot.taskId.isEmpty()) {
            ChatGptB1RunStore.failCoreIfCurrent(
                service, snapshot.runId, snapshot.taskId, snapshot.cycle, code
            );
        } else {
            // A delayed manual B1 UI failure must not terminate a replacement
            // Core lease or a newer manual cycle.
            ChatGptB1RunStore.failManualIfCurrent(
                service, snapshot.runId, snapshot.cycle, snapshot.startedAt, code
            );
        }
    }

    private static void markVerifyingObservedRun(
        AccessibilityBridgeService service, ChatGptB1RunStore.Snapshot snapshot
    ) {
        if (snapshot.taskId != null && !snapshot.taskId.isEmpty()) {
            ChatGptB1RunStore.markCoreVerifyingIfCurrent(
                service, snapshot.runId, snapshot.taskId, snapshot.cycle
            );
        } else {
            ChatGptB1RunStore.markManualVerifyingIfCurrent(
                service, snapshot.runId, snapshot.cycle, snapshot.startedAt
            );
        }
    }

    private static void markInputReadyObservedRun(
        AccessibilityBridgeService service, ChatGptB1RunStore.Snapshot snapshot
    ) {
        if (snapshot.taskId != null && !snapshot.taskId.isEmpty()) {
            ChatGptB1RunStore.markCoreInputReadyIfCurrent(
                service, snapshot.runId, snapshot.taskId, snapshot.cycle
            );
        } else {
            ChatGptB1RunStore.markManualInputReadyIfCurrent(
                service, snapshot.runId, snapshot.cycle, snapshot.startedAt
            );
        }
    }

    private static void markBusyObservedRun(
        AccessibilityBridgeService service, ChatGptB1RunStore.Snapshot snapshot
    ) {
        if (snapshot.taskId != null && !snapshot.taskId.isEmpty()) {
            ChatGptB1RunStore.markCoreBusyIfCurrent(
                service, snapshot.runId, snapshot.taskId, snapshot.cycle
            );
        } else {
            ChatGptB1RunStore.markManualBusyIfCurrent(
                service, snapshot.runId, snapshot.cycle, snapshot.startedAt
            );
        }
    }

    public static AccessibilityNodeInfo findExactProjectControl(
        AccessibilityNodeInfo root,
        String projectName
    ) {
        String wanted = normalize(projectName);
        if (root == null || wanted.isEmpty()) return null;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !nodeHasExactLabel(node, wanted)) continue;
            AccessibilityNodeInfo clickable = nearestClickable(node, 5);
            if (clickable == null || !clickable.isEnabled()) continue;

            // A user message can literally say TigerIQ AI Lab, including in
            // clickable content. Only choose a Project control when its own
            // ancestry proves it belongs to the navigation UI. A generic
            // scroll container or a bare matching label is not enough.
            boolean navigationScope = false;
            boolean conversationScope = false;
            boolean completeAncestry = false;
            AccessibilityNodeInfo current = node;
            for (int depth = 0; current != null && depth < 32; depth++) {
                if (current.isEditable()) conversationScope = true;
                String klass = normalize(String.valueOf(current.getClassName()));
                String id = normalize(text(current.getViewIdResourceName()));
                if (containsAny(klass, "drawerlayout", "navigationview")
                    || containsAny(id, "navigation_drawer", "nav_drawer", "sidebar",
                        "project_list", "projects_list", "project_item",
                        "project_row", "project_navigation", "nav_list")) {
                    navigationScope = true;
                }
                if (containsAny(klass, "messagebubble", "chatmessage", "transcript")
                    || containsAny(id, "message_list", "message_item", "message_row",
                        "chat_bubble", "chat_content", "chat_messages",
                        "transcript", "composer", "prompt_input")) {
                    conversationScope = true;
                }
                if (current.equals(root)) {
                    completeAncestry = true;
                    break;
                }
                current = current.getParent();
            }
            if (ChatGptB1Policy.isTrustedProjectNavigationTarget(
                clickable.isVisibleToUser() && clickable.isEnabled() && clickable.isClickable(),
                true, navigationScope, conversationScope, completeAncestry
            )) return clickable;
        }
        // Missing semantic navigation structure is a safe non-selection,
        // not permission to click an arbitrary matching chat message.
        return null;
    }

    public static AccessibilityNodeInfo findNewChatControl(AccessibilityNodeInfo root) {
        if (root == null) return null;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser()) continue;
            String label = searchable(node);
            if (!containsAny(label, "new chat", "chat mới", "trò chuyện mới", "cuộc trò chuyện mới", "new conversation")) continue;
            AccessibilityNodeInfo clickable = nearestClickable(node, 4);
            if (clickable != null && clickable.isEnabled()) return clickable;
        }
        return null;
    }

    public static AccessibilityNodeInfo findNavigationMenuControl(AccessibilityNodeInfo root) {
        if (root == null) return null;
        AccessibilityNodeInfo best = null;
        int bestScore = Integer.MIN_VALUE;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !node.isEnabled() || !node.isClickable()) continue;
            String label = searchable(node);
            if (containsAny(label, "settings", "search", "new chat", "voice", "camera", "profile", "account")) continue;
            int score = 0;
            if (containsAny(label, "open sidebar", "sidebar", "navigation drawer", "open navigation")) score += 140;
            if (containsAny(label, "menu", "mở menu", "thanh bên", "điều hướng")) score += 100;
            if (label.contains("button")) score += 5;
            if (score > bestScore) {
                best = node;
                bestScore = score;
            }
        }
        return bestScore >= 100 ? best : null;
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

    /**
     * Core only: look for exactly one explicitly labelled native Send button
     * inside a bounded composer region. Never scan the transcript, nav bar or
     * other clickable UI for a keyword/anonymous up-arrow guess.
     */
    public static AccessibilityNodeInfo findTrustedCoreSendControl(
        AccessibilityNodeInfo root, AccessibilityNodeInfo composerInput
    ) {
        if (root == null || composerInput == null
            || !composerInput.isVisibleToUser() || !composerInput.isEditable()) return null;
        AccessibilityNodeInfo cursor = composerInput;
        boolean belongsToRoot = false;
        for (int i = 0; cursor != null && i < 32; i++) {
            if (cursor.equals(root)) {
                belongsToRoot = true;
                break;
            }
            cursor = cursor.getParent();
        }
        if (!belongsToRoot) return null;

        AccessibilityNodeInfo scope = composerInput.getParent();
        for (int depth = 0; scope != null && depth < 4; depth++) {
            if (!scope.isVisibleToUser() || scope.isScrollable()) return null;
            String scopeClass = normalize(String.valueOf(scope.getClassName()));
            String scopeId = normalize(text(scope.getViewIdResourceName()));
            if (containsAny(scopeClass, "scrollview", "recyclerview", "listview", "webview")
                || containsAny(scopeId, "message_list", "conversation_list", "chat_list")) {
                return null;
            }

            AccessibilityNodeInfo found = null;
            int editables = 0;
            int inspected = 0;
            for (AccessibilityNodeInfo node : preorderNodes(scope)) {
                inspected++;
                if (inspected > 48) return null;
                String cls = normalize(String.valueOf(node.getClassName()));
                String id = normalize(text(node.getViewIdResourceName()));
                // If this scope includes the scrolling transcript, it cannot
                // authorize a Core Send click even when a named button exists.
                if (node.isScrollable()
                    || containsAny(cls, "scrollview", "recyclerview", "listview", "webview")
                    || containsAny(id, "message_list", "conversation_list", "chat_list")) {
                    return null;
                }
                if (node.isEditable()) {
                    editables++;
                    if (!node.equals(composerInput)) return null;
                }
                if (ChatGptB1Policy.isTrustedCoreSendControl(
                    node.isVisibleToUser(), node.isEnabled(), node.isClickable(),
                    String.valueOf(node.getClassName()),
                    text(node.getViewIdResourceName()),
                    text(node.getContentDescription())
                )) {
                    if (found != null && !found.equals(node)) return null;
                    found = node;
                }
            }
            if (editables == 1 && found != null) return found;
            scope = scope.getParent();
        }
        return null;
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

    /**
     * Scan structurally attributed transcript nodes in document order.
     * The platform-independent matcher makes old-token/duplicate-prompt
     * refusal executable under ordinary Android Worker JUnit.
     */
    static String coreResponseTextContaining(
        AccessibilityNodeInfo root, String token, String prompt, boolean sendClaimed
    ) {
        if (root == null || !sendClaimed || text(token).isEmpty() || text(prompt).isEmpty()) {
            return "";
        }
        ChatGptB1Policy.CoreReplyMatcher matcher =
            new ChatGptB1Policy.CoreReplyMatcher(prompt, token, sendClaimed);
        for (AccessibilityNodeInfo node : preorderNodes(root)) {
            if (!node.isVisibleToUser() || node.isEditable()) continue;
            String role = trustedMessageRole(node, root);
            if (role.isEmpty()) continue;
            String raw = text(node.getText());
            if (raw.isEmpty()) raw = text(node.getContentDescription());
            matcher.observe(role, raw);
        }
        return matcher.verifiedReply();
    }

    /** Refuse send if a matching task transcript already existed beforehand. */
    static boolean coreTranscriptAlreadyContainsTask(
        AccessibilityNodeInfo root, String prompt, String token
    ) {
        if (root == null || text(prompt).isEmpty() || text(token).isEmpty()) return true;
        ChatGptB1Policy.CoreReplyMatcher matcher =
            new ChatGptB1Policy.CoreReplyMatcher(prompt, token, false);
        for (AccessibilityNodeInfo node : preorderNodes(root)) {
            if (!node.isVisibleToUser() || node.isEditable()) continue;
            String role = trustedMessageRole(node, root);
            if (role.isEmpty()) continue;
            String raw = text(node.getText());
            if (raw.isEmpty()) raw = text(node.getContentDescription());
            matcher.observe(role, raw);
        }
        return matcher.hasPreexistingTaskTranscript();
    }

    /** Role evidence must reach the live root and never cross composer nodes. */
    private static String trustedMessageRole(
        AccessibilityNodeInfo node, AccessibilityNodeInfo root
    ) {
        boolean assistant = false;
        boolean user = false;
        boolean completeAncestry = false;
        AccessibilityNodeInfo current = node;
        for (int depth = 0; current != null && depth < 32; depth++) {
            if (current.isEditable()) return "";
            String marker = ChatGptB1Policy.structuralMessageRole(
                String.valueOf(current.getClassName()),
                text(current.getViewIdResourceName())
            );
            if ("ASSISTANT".equals(marker)) assistant = true;
            if ("USER".equals(marker)) user = true;
            if (current.equals(root)) {
                completeAncestry = true;
                break;
            }
            current = current.getParent();
        }
        return completeAncestry && assistant != user ? (assistant ? "ASSISTANT" : "USER") : "";
    }

    /** Preorder preserves transcript sequence; a breadth-first scan does not. */
    private static Iterable<AccessibilityNodeInfo> preorderNodes(AccessibilityNodeInfo root) {
        java.util.ArrayList<AccessibilityNodeInfo> out = new java.util.ArrayList<>();
        if (root == null) return out;
        Deque<AccessibilityNodeInfo> stack = new ArrayDeque<>();
        stack.push(root);
        while (!stack.isEmpty() && out.size() < MAX_NODES) {
            AccessibilityNodeInfo node = stack.pop();
            out.add(node);
            for (int i = node.getChildCount() - 1; i >= 0; i--) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) stack.push(child);
            }
        }
        return out;
    }

    static String responseTextContaining(AccessibilityNodeInfo root, String token, String prompt) {
        String wanted = normalize(token);
        if (root == null || wanted.isEmpty()) return "";
        String exactToken = text(token);
        String exactPrompt = text(prompt);
        String bestUseful = "";
        String bestAny = "";
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser()) continue;
            String raw = text(node.getText());
            if (raw.isEmpty()) raw = text(node.getContentDescription());
            if (raw.isEmpty() || !normalize(raw).contains(wanted)) continue;
            String candidate = raw.trim();
            if (!exactPrompt.isEmpty() && candidate.contains(exactPrompt)) {
                candidate = candidate.replace(exactPrompt, "").trim();
            }
            if (candidate.isEmpty() || !normalize(candidate).contains(wanted)) continue;
            if (bestAny.isEmpty() || candidate.length() < bestAny.length()) bestAny = candidate;
            String useful = exactToken.isEmpty() ? candidate : candidate.replace(exactToken, "").trim();
            if (!useful.isEmpty() && (bestUseful.isEmpty() || candidate.length() < bestUseful.length())) {
                bestUseful = candidate;
            }
        }
        String best = bestUseful.isEmpty() ? bestAny : bestUseful;
        if (best.length() > 4000) return best.substring(0, 4000);
        return best;
    }

    public static boolean treeContainsExactLabel(AccessibilityNodeInfo root, String label) {
        String wanted = normalize(label);
        if (wanted.isEmpty()) return false;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser()) continue;
            if (wanted.equals(normalize(text(node.getText())))
                || wanted.equals(normalize(text(node.getContentDescription())))
                || wanted.equals(normalize(text(node.getHintText())))) {
                return true;
            }
        }
        return false;
    }

    public static boolean treeContainsExactLabelOutsideClickableNavigation(
        AccessibilityNodeInfo root,
        String label,
        int ignoredMaxParents
    ) {
        String wanted = normalize(label);
        if (root == null || wanted.isEmpty()) return false;

        // Plain text in a chat bubble or a nested sidebar can equal the exact
        // Project name. Such labels are NOT authorization to mutate a Core task.
        // We need a semantic toolbar hierarchy in the active Accessibility tree.
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !nodeHasExactLabel(node, wanted)) continue;

            boolean semanticToolbar = false;
            boolean scrollOrMessageAncestor = false;
            boolean clickableAncestor = false;
            boolean reachesRoot = false;
            AccessibilityNodeInfo current = node;
            // Do not trust a depth-limited non-clickable prefix: the real
            // navigation or scrolling ancestor can be nested >3 levels deep.
            for (int depth = 0; current != null && depth < 32; depth++) {
                if (current.isClickable()) clickableAncestor = true;
                if (current.isScrollable() || current.isEditable()) {
                    scrollOrMessageAncestor = true;
                }
                String className = normalize(String.valueOf(current.getClassName()));
                String viewId = normalize(text(current.getViewIdResourceName()));
                if (containsAny(className, "scrollview", "recyclerview", "listview", "webview")
                    || containsAny(viewId, "scrollview", "recyclerview", "message_list",
                        "conversation_list", "chat_list")) {
                    scrollOrMessageAncestor = true;
                }
                // Structural toolbar identification, not merely a text heading:
                // a message in the transcript can itself be a heading.
                if (containsAny(className, "toolbar", "actionbar", "appbar")
                    || containsAny(viewId, "toolbar", "action_bar", "app_bar",
                        "project_header", "chat_header")) {
                    semanticToolbar = true;
                }
                if (current.equals(root)) {
                    reachesRoot = true;
                    break;
                }
                current = current.getParent();
            }
            if (ChatGptB1Policy.isVerifiedProjectHeaderEvidence(
                true, semanticToolbar, scrollOrMessageAncestor,
                clickableAncestor, reachesRoot
            )) return true;
        }
        // No toolbar semantic proof => fail closed, pending real S10 UI canary.
        return false;
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
