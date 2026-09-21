using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal static class Workers
{
    public static readonly WorkerDefinition[] All =
    [
        new("NV02", "ChatGPT Plus", 9222),
        new("NV03", "ChatGPT Go", 9223),
        new("NV04", "Gemini Pro", 9224),
    ];
    public static WorkerDefinition Get(string id) => All.Single(x => x.Id == id);
}

internal static class WorkerStateEvidenceRegistry
{
    static readonly Dictionary<string, WorkerEvidenceRecord> evidence = new(StringComparer.OrdinalIgnoreCase);
    public static void Record(string id, string status, string lastPrompt, string lastAction, bool paused)
    {
        evidence[id] = new WorkerEvidenceRecord(status, lastPrompt, lastAction, DateTimeOffset.UtcNow, paused);
    }
    public static WorkerEvidenceRecord? Get(string id) => evidence.TryGetValue(id, out var r) ? r : null;
}

internal sealed record WorkerEvidenceRecord(string Status, string LastPrompt, string LastAction, DateTimeOffset Timestamp, bool Paused);

internal sealed record WorkerDefinition(string Id, string Name, int DebugPort);
internal enum WorkerUiState { Ready, Working, Blocked, Paused }
internal sealed record WorkerView(
    string Id, WorkerUiState State, string Reason, string? JobId,
    string? JobTitle, string? JobStage, int? JobProgress,
    string? JobNextAction, string? JobEvidenceRef, string? JobResult,
    DateTimeOffset? JobLastActivityAt,
    DateTimeOffset? StatusSince, bool UiReady, bool AuthRequired,
    bool UiBusy, string? SecurityBlock, string? Url, int? TabPort,
    DateTimeOffset? HeartbeatAt, bool SessionOk, bool WindowOpen);
internal sealed class UtilitySettings
{
    public int LayoutRevision { get; set; }
    public bool DoNotDisturb { get; set; }
    public Dictionary<string, WorkerSettings> Workers { get; set; } = new();
    public Dictionary<string, ScheduleSettings> Schedules { get; set; } = new();

    public static UtilitySettings CreateDefault()
    {
        var value = new UtilitySettings();
        foreach (var w in TigerIQ.WorkerUtility.Workers.All)
            value.Workers[w.Id] = new WorkerSettings();
        return value;
    }
}

internal sealed class WorkerSettings
{
    public bool Paused { get; set; }
    public bool PositionLocked { get; set; }
    public DateTimeOffset? StateChangedAt { get; set; }
    public string? LastState { get; set; }
    public int? BadgeOffsetX { get; set; }
    public int? BadgeOffsetY { get; set; }
    public int? PopupX { get; set; }
    public int? PopupY { get; set; }
}

internal sealed class ScheduleSettings
{
    public int IntervalMinutes { get; set; }
    public DateTimeOffset? NextCheckAt { get; set; }
    public string LastFingerprint { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public bool ChangesOnly { get; set; } = true;
}
