package ai.tigeriq.worker.v07;

import android.content.Context;

import java.util.Collections;
import java.util.List;

/**
 * Phone-owned provider registry. Adding another AI means adding another connector here; PC01 never receives the provider key.
 * V1 ships Gemini first while keeping the connector boundary provider-neutral.
 */
public final class LocalAiProviderRegistry {
    private LocalAiProviderRegistry() {}

    public static List<String> supportedProviders() { return Collections.singletonList(ProviderConfigStore.GEMINI); }

    public static AiProviderConnector connector(Context context, String providerId) throws ProviderException {
        String provider = providerId == null ? "" : providerId.trim().toLowerCase();
        if (ProviderConfigStore.GEMINI.equals(provider)) return new GeminiDirectClient(context);
        throw new ProviderException(provider, "PROVIDER_UNSUPPORTED", "provider connector is not installed on this phone", false, 0);
    }
}
