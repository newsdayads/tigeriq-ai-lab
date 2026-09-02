package ai.tigeriq.worker.v07;

public final class ProviderExecution {
    public final String provider;
    public final String model;
    public final String text;
    public final String startedAt;
    public final String finishedAt;

    public ProviderExecution(String provider, String model, String text, String startedAt, String finishedAt) {
        this.provider = provider;
        this.model = model;
        this.text = text;
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
    }
}
