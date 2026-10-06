package ai.tigeriq.worker;

import org.junit.Test;

import static org.junit.Assert.assertTrue;

public final class StaleUpdateSessionRecoveryContractTest {
    @Test
    public void sourceContainsBoundedStaleRecoveryContract() throws Exception {
        String source = new String(
            java.nio.file.Files.readAllBytes(
                java.nio.file.Paths.get("src/main/java/ai/tigeriq/worker/WorkerUpdateEngine.java")
            ),
            java.nio.charset.StandardCharsets.UTF_8
        );
        assertTrue(source.contains("STALE_INSTALL_SESSION_RECOVERED"));
        assertTrue(source.contains("getSessionInfo(sessionId)"));
        assertTrue(source.contains("10 * 60 * 1000L"));
        assertTrue(source.contains("return false;"));
    }
}
