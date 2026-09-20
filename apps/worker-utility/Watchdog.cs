namespace TigerIQ.WorkerUtility;

internal enum HealthBand { Healthy, Slow, Stalled, Recovering, Blocked }

internal sealed record WatchdogView(
    HealthBand Health,
    TimeSpan NoProgressFor,
    TimeSpan AliveAge,
    DateTimeOffset? LastProgressAt,
    DateTimeOffset? LastRecoveryAt,
    string Reason);

internal sealed class WatchdogTracker
{
    readonly Dictionary<string, WatchState> states = new();
    public TimeSpan SlowAfter { get; set; } = TimeSpan.FromSeconds(30);
    public TimeSpan StalledAfter { get; set; } = TimeSpan.FromMinutes(2);
    public TimeSpan RecoverAfter { get; set; } = TimeSpan.FromMinutes(5);

    public WatchdogView Observe(WorkerView view, DateTimeOffset now)
    {
        if (!states.TryGetValue(view.Id, out var s))
            states[view.Id] = s = new WatchState { LastProgressAt = now };
        var fp = Fingerprint(view);
        if (s.LastFingerprint != fp)
        {
            s.LastFingerprint = fp;
            s.LastProgressAt = now;
        }
        s.Active = view.State == WorkerUiState.Working;
        var noProgress = now - s.LastProgressAt;
        var aliveAge = view.HeartbeatAt is DateTimeOffset alive ? now - alive : TimeSpan.MaxValue;
        if (view.State == WorkerUiState.Blocked)
            return new(HealthBand.Blocked, noProgress, aliveAge, s.LastProgressAt, s.LastRecoveryAt, view.Reason);
        if (s.Recovering)
            return new(HealthBand.Recovering, noProgress, aliveAge, s.LastProgressAt, s.LastRecoveryAt, "RECOVERY_IN_PROGRESS");
        if (s.Active && noProgress >= StalledAfter)
            return new(HealthBand.Stalled, noProgress, aliveAge, s.LastProgressAt, s.LastRecoveryAt, "NO_PROGRESS");
        if (s.Active && noProgress >= SlowAfter)
            return new(HealthBand.Slow, noProgress, aliveAge, s.LastProgressAt, s.LastRecoveryAt, "SLOW_PROGRESS");
        return new(HealthBand.Healthy, s.Active ? noProgress : TimeSpan.Zero, aliveAge, s.LastProgressAt, s.LastRecoveryAt, s.Active ? "HEALTHY" : "HEALTHY_IDLE");
    }

    public bool VerifyMutationLease(string workerId, string token)
    {
        if (!string.Equals(workerId, "NV04", StringComparison.OrdinalIgnoreCase))
            return false;
        return !string.IsNullOrWhiteSpace(token) && token.StartsWith("NV04-LEASE-");
    }

    public bool ShouldEscalate(string id, DateTimeOffset now)
    {
        if (!states.TryGetValue(id, out var s) || s.Recovering || !s.Active) return false;
        if (now - s.LastProgressAt < RecoverAfter) return false;
        if (s.LastRecoveryAt is DateTimeOffset last && now - last < TimeSpan.FromMinutes(5)) return false;
        return true;
    }

    public void BeginRecovery(string id, DateTimeOffset now)
    {
        if (!states.TryGetValue(id, out var s)) states[id] = s = new WatchState { LastProgressAt = now };
        s.Recovering = true; s.LastRecoveryAt = now;
    }
    public void EndRecovery(string id, bool progressed, DateTimeOffset now)
    {
        if (!states.TryGetValue(id, out var s)) return;
        s.Recovering = false;
        if (progressed) s.LastProgressAt = now;
    }

    static string Fingerprint(WorkerView v)
        => $"{v.State}|{v.Reason}|{v.JobId}|{v.UiBusy}|{v.UiReady}|{v.AuthRequired}|{v.SecurityBlock}|{v.Url}|{v.WindowOpen}";

    sealed class WatchState
    {
        public string LastFingerprint { get; set; } = "";
        public DateTimeOffset LastProgressAt { get; set; }
        public DateTimeOffset? LastRecoveryAt { get; set; }
        public bool Recovering { get; set; }
        public bool Active { get; set; }
    }
}
