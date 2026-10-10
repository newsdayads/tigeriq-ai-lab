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

    @Test
    public void mobileLeaseBindingAndAcknowledgementPersistBeforeResuming() throws Exception {
        String source = new String(
            Files.readAllBytes(Paths.get("src/main/java/ai/tigeriq/worker/MobileTaskStore.java")),
            StandardCharsets.UTF_8
        );
        String[] starts = {
            "public static Snapshot bind(",
            "public static Snapshot rebindLease(",
            "public static void markResultReported("
        };
        String[] ends = {
            "public static Snapshot rebindLease(",
            "public static void markResultReported(",
            "public static void clear("
        };
        String[] failureMarkers = {
            "CORE_TASK_BIND_PERSIST_FAILED",
            "CORE_TASK_REBIND_PERSIST_FAILED",
            "CORE_TASK_REPORT_ACK_PERSIST_FAILED"
        };
        for (int i = 0; i < starts.length; i++) {
            int begin = source.indexOf(starts[i]);
            int end = source.indexOf(ends[i], begin);
            assertTrue("missing durable lease boundary " + i, begin >= 0 && end > begin);
            String section = source.substring(begin, end);
            assertTrue("missing synchronous persistence " + i, section.contains(".commit()"));
            assertTrue("missing failed-write guard " + i, section.contains(failureMarkers[i]));
            assertFalse("async write can lose lease on restart " + i, section.contains(".apply()"));
        }
        String bind = source.substring(
            source.indexOf(starts[0]), source.indexOf(starts[1])
        );
        assertTrue(bind.contains(".putString(K_TASK_ID,taskId)"));
        assertTrue(bind.contains(".putString(K_LEASE_ID,leaseId)"));
        assertTrue(bind.contains(".putString(K_RUN_ID,runId)"));
        assertTrue(bind.contains(".putBoolean(K_RESULT_REPORTED,false)"));
    }
    @Test
    public void leaseReacquisitionCannotSwapThePinnedCoreTaskPayload() throws Exception {
        String source = new String(
            Files.readAllBytes(Paths.get("src/main/java/ai/tigeriq/worker/MobileTaskStore.java")),
            StandardCharsets.UTF_8
        );
        int begin = source.indexOf("public static Snapshot rebindLease(");
        int end = source.indexOf("public static void markResultReported(", begin);
        assertTrue(begin >= 0 && end > begin);
        String rebind = source.substring(begin, end);
        assertTrue("reacquired lease must include its original prompt",
            rebind.contains("current.prompt.equals(prompt)"));
        assertTrue("reacquired lease must preserve the expected completion token",
            rebind.contains("current.expectedToken.equals(expectedToken)"));
        assertTrue("rebind must check before committing a new lease id",
            rebind.indexOf("current.prompt.equals(prompt)") < rebind.indexOf(".putString(K_LEASE_ID"));
    }

}
