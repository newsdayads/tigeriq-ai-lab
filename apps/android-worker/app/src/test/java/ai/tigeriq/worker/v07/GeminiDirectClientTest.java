package ai.tigeriq.worker.v07;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

public final class GeminiDirectClientTest {
    @Test public void requestContainsPromptButNoCredentialField() throws Exception {
        JSONObject request = GeminiDirectClient.buildRequest("hello TigerIQ");
        String serialized = request.toString();
        assertTrue(serialized.contains("hello TigerIQ"));
        assertFalse(serialized.toLowerCase().contains("api_key"));
        assertFalse(serialized.toLowerCase().contains("apikey"));
    }

    @Test public void parsesTextAcrossGeminiParts() throws Exception {
        JSONObject response = new JSONObject().put("candidates", new JSONArray().put(
                new JSONObject().put("content", new JSONObject().put("parts", new JSONArray()
                        .put(new JSONObject().put("text", "first"))
                        .put(new JSONObject().put("text", "second"))))));
        assertEquals("first\nsecond", GeminiDirectClient.parseText(response));
    }

    @Test public void missingCandidatesReturnsEmptyForFailClosedHandling() throws Exception {
        assertEquals("", GeminiDirectClient.parseText(new JSONObject()));
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsModelPathInjection() {
        ProviderConfigStore.requireModel("../../bad:model");
    }
}
