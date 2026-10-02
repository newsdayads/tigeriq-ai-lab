package ai.tigeriq.worker;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class EmployeeProfileStoreTest {
    @Test
    public void providerDefaultsToChatGptAndNormalizesGemini() {
        assertEquals("ChatGPT", EmployeeProfileStore.normalizeProvider(null));
        assertEquals("ChatGPT", EmployeeProfileStore.normalizeProvider("chatgpt"));
        assertEquals("Gemini", EmployeeProfileStore.normalizeProvider(" Gemini "));
    }
}
