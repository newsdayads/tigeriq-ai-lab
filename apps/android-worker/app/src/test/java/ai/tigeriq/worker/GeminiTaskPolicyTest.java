package ai.tigeriq.worker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import org.junit.Test;

public final class GeminiTaskPolicyTest {
    private static final String PROMPT = "Hãy tóm tắt 3 điểm chính của tài liệu hiện tại";
    private static final String OLD = "Đây là phản hồi cũ đủ dài và tuyệt đối không thuộc công việc mới đang được thực hiện.";
    private static final String FRESH = "Đây là phản hồi mới cho đúng công việc hiện tại, đủ dài để được xem là bằng chứng kết quả.";

    @Test public void priorChatAndUnrelatedTextBeforePromptAreExcluded() {
        List<String> before = Arrays.asList("Gemini", OLD, "Copy", PROMPT);
        Set<String> baseline = GeminiTaskPolicy.baselineHashes(before, PROMPT);
        List<String> after = Arrays.asList("Gemini", OLD, "Copy", PROMPT, FRESH, "Copy");
        List<String> candidates = GeminiTaskPolicy.currentTurnCandidates(after, PROMPT, baseline);
        assertEquals(Collections.singletonList(FRESH), candidates);
    }

    @Test public void staleCompletionMarkerCannotCompleteNewTask() {
        List<String> candidates = Collections.singletonList(FRESH);
        assertFalse(GeminiTaskPolicy.completionReady(8_000L, 3, 3, candidates));
        assertTrue(GeminiTaskPolicy.completionReady(8_000L, 3, 4, candidates));
    }

    @Test public void duplicateAccessibilityTextsAreDeduplicated() {
        Set<String> baseline = GeminiTaskPolicy.baselineHashes(Arrays.asList(OLD), PROMPT);
        List<String> after = Arrays.asList(PROMPT, FRESH, FRESH, "Copy");
        List<String> candidates = GeminiTaskPolicy.currentTurnCandidates(after, PROMPT, baseline);
        assertEquals(1, candidates.size());
        assertEquals(FRESH, candidates.get(0));
    }

    @Test public void submittedTaskResumesOnlyWithPersistedBoundary() {
        assertTrue(GeminiTaskPolicy.resumableSubmitted("SUBMITTED", true));
        assertFalse(GeminiTaskPolicy.resumableSubmitted("SUBMITTED", false));
        assertFalse(GeminiTaskPolicy.resumableSubmitted("QUEUED", true));
    }

    @Test public void responseWithoutCurrentPromptAnchorFailsClosed() {
        Set<String> baseline = GeminiTaskPolicy.baselineHashes(Arrays.asList(OLD), PROMPT);
        List<String> candidates = GeminiTaskPolicy.currentTurnCandidates(Arrays.asList(OLD, FRESH, "Copy"), PROMPT, baseline);
        assertTrue(candidates.isEmpty());
    }

    @Test public void loginProviderLimitAndTimeoutAreClassified() {
        assertEquals("LOGIN_REQUIRED", GeminiTaskPolicy.immediateFailure("Please sign in to continue", "QUEUED", 100L));
        assertEquals("PROVIDER_LIMIT", GeminiTaskPolicy.immediateFailure("You've reached your limit", "SUBMITTED", 5_000L));
        assertEquals("TIMEOUT", GeminiTaskPolicy.immediateFailure("normal screen", "SUBMITTED", GeminiTaskPolicy.RESPONSE_TIMEOUT_MS + 1L));
        assertEquals("", GeminiTaskPolicy.immediateFailure("normal screen", "SUBMITTED", 10_000L));
    }

    @Test public void responseMustBeOldEnoughAndLongEnough() {
        assertFalse(GeminiTaskPolicy.completionReady(1_000L, 0, 1, Collections.singletonList(FRESH)));
        assertFalse(GeminiTaskPolicy.completionReady(8_000L, 0, 1, Collections.singletonList("ngắn")));
        assertTrue(GeminiTaskPolicy.completionReady(8_000L, 0, 1, Collections.singletonList(FRESH)));
    }
}
