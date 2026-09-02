package ai.tigeriq.worker.v07;

public interface AiProviderConnector {
    String providerId();
    ProviderExecution execute(String prompt, String model) throws ProviderException;
}
