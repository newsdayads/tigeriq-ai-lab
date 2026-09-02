package ai.tigeriq.worker.v07;

import android.content.Context;
import android.content.SharedPreferences;

public final class ProviderConfigStore {
    public static final String GEMINI = "gemini";
    public static final String DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
    private static final String PREFS = "tigeriq_v1_provider_config";
    private static final String GEMINI_KEY = "provider:gemini:apiKey";
    private static final String LEGACY_GEMINI_BILLING_STATE = "geminiBillingState";
    private final SharedPreferences prefs;
    private final SecureSecretStore secrets;

    public ProviderConfigStore(Context context) {
        Context app = context.getApplicationContext();
        prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        secrets = new SecureSecretStore(app);
        // Issue #150: delete legacy self-asserted billing state. It is never authority.
        prefs.edit().remove(LEGACY_GEMINI_BILLING_STATE).apply();
    }

    public synchronized void saveGemini(String apiKey, String model) throws Exception {
        String normalizedModel = requireModel(model);
        String key = apiKey == null ? "" : apiKey.trim();
        if (!key.isEmpty()) {
            if (key.length() < 16 || key.length() > 512) throw new IllegalArgumentException("Gemini API key format is invalid");
            secrets.put(GEMINI_KEY, key);
        } else if (!hasGeminiKey()) {
            throw new IllegalArgumentException("Gemini API key is required");
        }
        if (!prefs.edit()
                .putString("defaultProvider", GEMINI)
                .putString("geminiModel", normalizedModel)
                .remove(LEGACY_GEMINI_BILLING_STATE)
                .commit()) {
            throw new IllegalStateException("cannot persist provider configuration");
        }
    }

    public synchronized boolean hasGeminiKey() throws Exception {
        String value = secrets.get(GEMINI_KEY);
        return value != null && !value.isBlank();
    }

    public synchronized String geminiApiKey() throws Exception {
        String value = secrets.get(GEMINI_KEY);
        if (value == null || value.isBlank()) throw new ProviderException(GEMINI, "PROVIDER_NOT_CONFIGURED", "Gemini API key is not configured on this phone", false, 0);
        return value;
    }

    public synchronized String defaultProvider() { return prefs.getString("defaultProvider", GEMINI); }
    public synchronized String geminiModel() { return prefs.getString("geminiModel", DEFAULT_GEMINI_MODEL); }

    /** No local preference/checkbox can authorize provider execution. */
    public synchronized ZeroCostAuthority zeroCostAuthority() { return ZeroCostAuthority.current(); }

    public synchronized void clearGemini() {
        secrets.remove(GEMINI_KEY);
        prefs.edit().remove("geminiModel").remove("defaultProvider").remove(LEGACY_GEMINI_BILLING_STATE).commit();
    }

    static String requireModel(String value) {
        String model = value == null ? "" : value.trim();
        if (model.isEmpty()) model = DEFAULT_GEMINI_MODEL;
        if (!model.matches("^[A-Za-z0-9._-]{1,80}$")) throw new IllegalArgumentException("invalid model name");
        return model;
    }
}
