package ai.tigeriq.worker.v07;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/** Direct phone -> Gemini API connector. Provider credentials never transit PC01/TigerIQ. */
public final class GeminiDirectClient implements AiProviderConnector {
    private static final String PROVIDER = ProviderConfigStore.GEMINI;
    private static final String API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models/";
    private static final int MAX_RESPONSE_BYTES = 1_000_000;
    private final ProviderConfigStore config;

    public GeminiDirectClient(Context context) { config = new ProviderConfigStore(context); }

    @Override public String providerId() { return PROVIDER; }

    @Override public ProviderExecution execute(String prompt, String model) throws ProviderException {
        // Defense in depth: no code path may reach Gemini unless zero-cost is explicitly confirmed.
        ZeroCostPolicy.requireExecutionAllowed(PROVIDER, config.geminiBillingState());
        String safeModel = ProviderConfigStore.requireModel(model);
        String textPrompt = prompt == null ? "" : prompt.trim();
        if (textPrompt.isEmpty()) throw new ProviderException(PROVIDER, "EMPTY_PROMPT", "job prompt is empty", false, 0);
        if (textPrompt.length() > 200_000) throw new ProviderException(PROVIDER, "PROMPT_TOO_LARGE", "job prompt exceeds phone worker limit", false, 0);
        String apiKey;
        try { apiKey = config.geminiApiKey(); }
        catch (ProviderException error) { throw error; }
        catch (Exception error) { throw new ProviderException(PROVIDER, "KEYSTORE_READ_FAILED", "cannot read local Gemini credential", false, 0); }

        String startedAt = Instant.now().toString();
        HttpURLConnection connection = null;
        try {
            URL url = new URL(API_ROOT + safeModel + ":generateContent");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(135_000);
            connection.setUseCaches(false);
            connection.setDoInput(true);
            connection.setDoOutput(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Cache-Control", "no-store");
            connection.setRequestProperty("x-goog-api-key", apiKey);
            byte[] body = buildRequest(textPrompt).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body); }

            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            byte[] responseBytes = readLimited(stream);
            if (status < 200 || status >= 300) {
                boolean retryable = status == 408 || status == 409 || status == 429 || status >= 500;
                String code = status == 401 || status == 403 ? "PROVIDER_AUTH" : status == 429 ? "PROVIDER_QUOTA" : "PROVIDER_HTTP_" + status;
                throw new ProviderException(PROVIDER, code, "Gemini request failed", retryable, status);
            }
            JSONObject response = responseBytes.length == 0 ? new JSONObject() : new JSONObject(new String(responseBytes, StandardCharsets.UTF_8));
            String output = parseText(response);
            if (output.isBlank()) throw new ProviderException(PROVIDER, "EMPTY_PROVIDER_OUTPUT", "Gemini returned no text output", true, status);
            return new ProviderExecution(PROVIDER, safeModel, output, startedAt, Instant.now().toString());
        } catch (ProviderException error) {
            throw error;
        } catch (java.net.SocketTimeoutException error) {
            throw new ProviderException(PROVIDER, "PROVIDER_TIMEOUT", "Gemini timed out", true, 0);
        } catch (java.io.IOException error) {
            throw new ProviderException(PROVIDER, "PROVIDER_NETWORK", "Gemini network error", true, 0);
        } catch (Exception error) {
            throw new ProviderException(PROVIDER, "PROVIDER_INVALID_RESPONSE", "Gemini response was invalid", false, 0);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static JSONObject buildRequest(String prompt) throws Exception {
        return new JSONObject().put("contents", new JSONArray().put(
                new JSONObject().put("role", "user").put("parts", new JSONArray().put(new JSONObject().put("text", prompt)))));
    }

    static String parseText(JSONObject response) throws Exception {
        JSONArray candidates = response.optJSONArray("candidates");
        if (candidates == null || candidates.length() == 0) return "";
        JSONObject content = candidates.optJSONObject(0) == null ? null : candidates.optJSONObject(0).optJSONObject("content");
        JSONArray parts = content == null ? null : content.optJSONArray("parts");
        if (parts == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < parts.length(); i++) {
            JSONObject part = parts.optJSONObject(i);
            String value = part == null ? "" : part.optString("text", "");
            if (!value.isEmpty()) { if (out.length() > 0) out.append('\n'); out.append(value); }
        }
        return out.toString().trim();
    }

    private static byte[] readLimited(InputStream stream) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0, read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new ProviderException(PROVIDER, "PROVIDER_RESPONSE_TOO_LARGE", "Gemini response too large", false, 0);
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }
}
