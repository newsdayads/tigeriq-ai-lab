package ai.tigeriq.worker;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** Source contract: a leased Core run must never be published as a manual B1 run. */
public final class ChatGptB1CoreInitContractTest {
    @Test
    public void coreIdentityIsStagedTogetherAndDurablyCommittedOnce() throws Exception {
        String source = new String(
            Files.readAllBytes(Paths.get("src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java")),
            StandardCharsets.UTF_8
        );
        int start = source.indexOf("public static synchronized Snapshot startTask(");
        int end = source.indexOf("public static void cancel(", start);
        assertTrue(start >= 0 && end > start);
        String coreStart = source.substring(start, end);
        assertTrue(coreStart.contains("newRunEditor(context, 1, runId.trim())"));
        assertTrue(coreStart.contains(".putString(K_TASK_ID, taskId.trim())"));
        assertTrue(coreStart.contains(".putString(K_CUSTOM_PROMPT, prompt.trim())"));
        assertTrue(coreStart.contains(".putString(K_CUSTOM_EXPECTED_TOKEN, expectedToken.trim())"));
        assertTrue(coreStart.contains(".commit()"));
        assertTrue(coreStart.contains("CORE_TASK_START_PERSIST_FAILED"));
        assertFalse(coreStart.contains("start(context, 1)"));
        assertFalse(coreStart.contains(".apply()"));
    }

    @Test
    public void commonRunEditorClearsOldRunWithoutPublishingIt() throws Exception {
        String source = new String(
            Files.readAllBytes(Paths.get("src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java")),
            StandardCharsets.UTF_8
        );
        int start = source.indexOf("private static SharedPreferences.Editor newRunEditor(");
        int end = source.indexOf("public static synchronized Snapshot start(", start);
        assertTrue(start >= 0 && end > start);
        String editor = source.substring(start, end);
        assertTrue(editor.contains(".edit().clear()"));
        assertTrue(editor.contains(".putString(K_RUN_ID, runId)"));
        assertTrue(editor.contains(".putString(K_STATE, \"WAITING_PROJECT\")"));
        assertTrue(editor.contains(".putBoolean(K_PROJECT_BOUND, false)"));
        assertFalse(editor.contains(".apply()"));
        assertFalse(editor.contains(".commit()"));
        // The independent manual B1 path still keeps its previous behavior.
        assertTrue(source.contains(
            "newRunEditor(context, requestedCycles, UUID.randomUUID().toString()).apply()"
        ));
    }
}
