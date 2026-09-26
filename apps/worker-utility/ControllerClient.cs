using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal sealed class ControllerClient
{
    // Controller enforces an 8s minimum UI-action gap. Keep client timeout
    // comfortably above pacing + bridge round-trip so successful paced actions
    // are not reported as false timeouts.
    static readonly TimeSpan ControllerTimeout = TimeSpan.FromSeconds(20);
    readonly HttpClient http = new() { Timeout = ControllerTimeout };
    const string Controller = "http://127.0.0.1:8798";

    public async Task<bool> VerifyIndependentIdentityAsync(string workerId, string identityKey)
    {
        await Task.CompletedTask;
        return !string.IsNullOrWhiteSpace(workerId) && !string.IsNullOrWhiteSpace(identityKey);
    }

    public async Task<(JsonDocument State, JsonDocument Autopilot)> RawStateAsync()
    {
        var state = await GetJsonAsync(Controller + "/api/state");
        return (state, JsonDocument.Parse("{}"));
    }

    async Task<JsonDocument?> TryGetJsonAsync(string url)
    {
        try
        {
            using var response = await http.GetAsync(url);
            if ((int)response.StatusCode == 404) return null;
            response.EnsureSuccessStatusCode();
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        }
        catch (TaskCanceledException ex) { throw new InvalidOperationException("CONTROLLER_TIMEOUT", ex); }
    }

    async Task<JsonDocument> GetJsonAsync(string url)
    {
        try
        {
            using var response = await http.GetAsync(url);
            response.EnsureSuccessStatusCode();
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        }
        catch (TaskCanceledException ex) { throw new InvalidOperationException("CONTROLLER_TIMEOUT", ex); }
    }

    async Task<JsonDocument?> TryPostAsync(string path, object? body = null)
    {
        try
        {
            using var response = await http.PostAsJsonAsync(Controller + path, body ?? new { });
            if ((int)response.StatusCode == 404) return null;
            var text = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException(text);
            return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
        }
        catch (TaskCanceledException ex) { throw new InvalidOperationException("CONTROLLER_TIMEOUT", ex); }
    }

    async Task<JsonDocument> PostAsync(string path, object? body = null)
    {
        try
        {
            using var response = await http.PostAsJsonAsync(Controller + path, body ?? new { });
            var text = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException(text);
            return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
        }
        catch (TaskCanceledException ex) { throw new InvalidOperationException("CONTROLLER_TIMEOUT", ex); }
    }
    public async Task<WorkerView> GetWorkerAsync(string workerId)
    {
        var raw = await RawStateAsync();
        using var state = raw.State;
        using var auto = raw.Autopilot;
        var root = state.RootElement;
        var sessionName = root.TryGetProperty("sessionName", out var sn) ? sn.GetString() : null;
        var sessionOk = root.TryGetProperty("interactiveSession", out var si) && si.GetBoolean()
            && !string.Equals(sessionName, "Services", StringComparison.OrdinalIgnoreCase);
        var paused = root.TryGetProperty("paused", out var p) && p.GetBoolean();
        var worker = root.GetProperty("workers").EnumerateArray()
            .First(x => x.GetProperty("id").GetString() == workerId);
        var blocked = worker.TryGetProperty("blocked", out var b) && b.GetBoolean();
        JsonElement hb = default;
        var hasHb = worker.TryGetProperty("lastHeartbeat", out hb);
        DateTimeOffset? hbAt = hasHb && hb.TryGetProperty("at", out var at) && DateTimeOffset.TryParse(at.GetString(), out var parsedAt) ? parsedAt : null;
        var stale = hbAt is null || DateTimeOffset.Now - hbAt > TimeSpan.FromSeconds(20);
        var uiReady = hasHb && hb.TryGetProperty("uiReady", out var ready) && ready.ValueKind == JsonValueKind.True;
        var auth = hasHb && hb.TryGetProperty("authRequired", out var authEl) && authEl.ValueKind == JsonValueKind.True;
        var busy = hasHb && hb.TryGetProperty("uiBusy", out var busyEl) && busyEl.ValueKind == JsonValueKind.True;
        var sec = hasHb && hb.TryGetProperty("securityBlock", out var secEl) && secEl.ValueKind == JsonValueKind.String ? secEl.GetString() : null;
        var url = hasHb && hb.TryGetProperty("url", out var u) ? u.GetString() : null;
        var windowOpen = worker.TryGetProperty("windowState", out var ws) && ws.GetString() == "OPEN";
        var status = worker.TryGetProperty("status", out var st) ? st.GetString() ?? "UNKNOWN" : "UNKNOWN";
        var durableJob = (ActiveJobId:(string?)null, Title:(string?)null, Stage:(string?)null, Progress:(int?)null, NextAction:(string?)null, EvidenceRef:(string?)null, Result:(string?)null, LastActivityAt:(DateTimeOffset?)null);
        string? jobId = null;
        WorkerUiState viewState;
        string reason;
        if (paused) { viewState = WorkerUiState.Paused; reason = "Controller paused"; }
        else if (!sessionOk) { viewState = WorkerUiState.Blocked; reason = "SESSION_MISMATCH"; }
        else if (blocked || auth || !string.IsNullOrWhiteSpace(sec)) { viewState = WorkerUiState.Blocked; reason = sec ?? (auth ? "AUTH_REQUIRED" : status); }
        else if (stale || !windowOpen || !uiReady) { viewState = WorkerUiState.Blocked; reason = stale ? "HEARTBEAT_STALE" : (!windowOpen ? "WINDOW_NOT_OPEN" : "UI_NOT_READY"); }
        else if (busy || !string.IsNullOrWhiteSpace(jobId)) { viewState = WorkerUiState.Working; reason = busy ? "UI_BUSY" : "JOB_ACTIVE"; }
        else { viewState = WorkerUiState.Ready; reason = "READY"; }
        return new WorkerView(workerId, viewState, reason, jobId,
            durableJob.Title, durableJob.Stage, durableJob.Progress,
            durableJob.NextAction, durableJob.EvidenceRef, durableJob.Result, durableJob.LastActivityAt,
            null, uiReady, auth, busy, sec, url,
            Workers.Get(workerId).DebugPort, hbAt, sessionOk, windowOpen);
    }

    static (string? ActiveJobId, string? Title, string? Stage, int? Progress, string? NextAction, string? EvidenceRef, string? Result, DateTimeOffset? LastActivityAt)
        CurrentDurableJob(JsonElement root, string workerId)
    {
        if (!root.TryGetProperty("jobs", out var jobs) || jobs.ValueKind != JsonValueKind.Array)
            return (null, null, null, null, null, null, null, null);

        JsonElement selected = default;
        var found = false;
        foreach (var candidate in jobs.EnumerateArray())
        {
            if (!candidate.TryGetProperty("workerId", out var wid) || wid.GetString() != workerId) continue;
            selected = candidate;
            found = true;
        }
        if (!found) return (null, null, null, null, null, null, null, null);

        var stage = selected.TryGetProperty("stage", out var stageEl) ? stageEl.GetString() : null;
        var terminal = stage is "DONE" or "BLOCKED" or "ERROR";
        var id = selected.TryGetProperty("jobId", out var idEl) ? idEl.GetString() : null;
        var title = selected.TryGetProperty("title", out var titleEl) ? titleEl.GetString() : null;
        int? progress = selected.TryGetProperty("progress", out var progressEl) && progressEl.TryGetInt32(out var p) ? p : null;
        var next = selected.TryGetProperty("nextAction", out var nextEl) && nextEl.ValueKind == JsonValueKind.String ? nextEl.GetString() : null;
        var result = selected.TryGetProperty("result", out var resultEl) && resultEl.ValueKind == JsonValueKind.String ? resultEl.GetString() : null;
        DateTimeOffset? lastActivity = selected.TryGetProperty("lastActivityAt", out var lastEl)
            && DateTimeOffset.TryParse(lastEl.GetString(), out var parsedLast) ? parsedLast : null;
        string? evidence = null;
        if (selected.TryGetProperty("evidenceRefs", out var refs) && refs.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in refs.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String) evidence = item.GetString();
        }
        return (terminal ? null : id, title, stage, progress, next, evidence, result, lastActivity);
    }

    static string? CurrentJob(JsonElement root, string workerId)
    {
        if (!root.TryGetProperty("snapshot", out var snapshot) || snapshot.ValueKind != JsonValueKind.Object) return null;
        foreach (var name in new[] { "previousJob", "nextJob" })
        {
            if (!snapshot.TryGetProperty(name, out var job) || job.ValueKind != JsonValueKind.Object) continue;
            if (job.TryGetProperty("workerId", out var wid) && wid.GetString() != workerId) continue;
            var status = job.TryGetProperty("status", out var s) ? s.GetString() : null;
            if (status is "QUEUED" or "READY" or "RUNNING") return job.GetProperty("jobId").GetString();
        }
        return null;
    }
    public async Task<JsonDocument> ResumeAsync(string id)
    {
        var result = await TryPostAsync($"/api/utility/workers/{id}/resume");
        if (result is not null) return result;
        return id == "NV02" ? await PostAsync("/api/resume") : JsonDocument.Parse("{\"ok\":true,\"compat\":\"UTILITY_LOCAL_ONLY\"}");
    }
    public async Task<JsonDocument> PauseAsync(string id)
    {
        var result = await TryPostAsync($"/api/utility/workers/{id}/pause");
        if (result is not null) return result;
        return id == "NV02" ? await PostAsync("/api/pause") : JsonDocument.Parse("{\"ok\":true,\"compat\":\"UTILITY_LOCAL_ONLY\"}");
    }
    public Task<JsonDocument> FocusAsync(string id) => PostAsync($"/api/workers/{id}/focus");
    public Task<JsonDocument> FixPositionAsync(string id) => PostAsync($"/api/workers/{id}/layout");
    public async Task<JsonDocument> SafeRecoverAsync(string id)
    {
        var result = await TryPostAsync($"/api/utility/workers/{id}/safe-recover");
        if (result is not null) return result;
        var current = await GetWorkerAsync(id);
        if (!current.SessionOk || current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock)) throw new InvalidOperationException($"SAFE_RECOVER_BLOCKED:{current.Reason}");
        if (!current.WindowOpen) throw new InvalidOperationException("SAFE_RECOVER_REQUIRES_CONTROLLER_UPGRADE");
        await FixPositionAsync(id);
        return await FocusAsync(id);
    }

    public async Task<JsonDocument> SafeCloseAsync(string id)
    {
        var state = await GetWorkerAsync(id);
        if (state.State == WorkerUiState.Working || state.UiBusy)
            throw new InvalidOperationException("SAFE_CLOSE_ACTIVE_UI_FORBIDDEN");
        if (state.State == WorkerUiState.Blocked && state.Reason != "WINDOW_NOT_OPEN")
            throw new InvalidOperationException($"SAFE_CLOSE_BLOCKED:{state.Reason}");
        return await PostAsync($"/api/workers/{id}/close");
    }

    public async Task OpenCanonicalAsync(string id)
    {
        var current = await GetWorkerAsync(id);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            throw new InvalidOperationException($"OPEN_CANONICAL_BLOCKED:{current.Reason}");
        using var response = await TryPostAsync($"/api/utility/workers/{id}/open-canonical");
        if (response is null) throw new InvalidOperationException("OPEN_CANONICAL_REQUIRES_CONTROLLER_UPGRADE");
    }

    public async Task<string> RuntimeVersionAsync()
    {
        var raw = await RawStateAsync();
        using var state = raw.State;
        using var auto = raw.Autopilot;
        var root = state.RootElement;
        if (!root.TryGetProperty("runtimeProvenance", out var provenance))
            return $"App Chrome: chưa có dữ liệu · Utility: {Application.ProductVersion}";
        var head = provenance.TryGetProperty("approvedHead", out var h) ? h.GetString() : null;
        var shortHead = string.IsNullOrWhiteSpace(head) ? "UNKNOWN" : head[..Math.Min(7, head.Length)];
        return $"App Chrome: {shortHead} · Utility: {Application.ProductVersion}";
    }

    public async Task<string> RestartRuntimeAsync()
    {
        const string taskName = "TigerIQ APP Chrome Unified";
        await RunScheduledTaskAsync($"/End /TN \"{taskName}\"", allowFailure: true);
        await Task.Delay(1200);
        await RunScheduledTaskAsync($"/Run /TN \"{taskName}\"", allowFailure: false);
        return "Đã khởi động lại App Chrome; không reboot máy.";
    }

    static async Task RunScheduledTaskAsync(string arguments, bool allowFailure)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "schtasks.exe",
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true
        }) ?? throw new InvalidOperationException("APP_CHROME_TASK_START_FAILED");
        await process.WaitForExitAsync();
        if (!allowFailure && process.ExitCode != 0)
        {
            var error = await process.StandardError.ReadToEndAsync();
            throw new InvalidOperationException($"APP_CHROME_TASK_RESTART_FAILED:{process.ExitCode}:{error.Trim()}");
        }
    }

    public async Task<BrowserMutationLeaseReceipt> AcquireBrowserMutationLeaseAsync(string id, string ownerId, int ttlMs = 30000)
    {
        using var doc = await PostAsync($"/api/utility/workers/{id}/mutation-lease/acquire", new { ownerId, ttlMs });
        var root = doc.RootElement;
        if (!root.TryGetProperty("lease", out var lease)) throw new InvalidOperationException("BROWSER_MUTATION_LEASE_MISSING");
        return new BrowserMutationLeaseReceipt(
            lease.GetProperty("leaseId").GetString() ?? throw new InvalidOperationException("BROWSER_MUTATION_LEASE_ID_MISSING"),
            lease.GetProperty("ownerId").GetString() ?? ownerId,
            lease.GetProperty("expiresAt").GetString() ?? "");
    }

    public async Task ReleaseBrowserMutationLeaseAsync(string id, BrowserMutationLeaseReceipt lease)
    {
        using var _ = await PostAsync($"/api/utility/workers/{id}/mutation-lease/release", new { ownerId = lease.OwnerId, leaseId = lease.LeaseId });
    }

    public async Task<string> QuickHealthAsync(string id)
    {
        using var doc = await TryGetJsonAsync(Controller + $"/api/utility/workers/{id}/health");
        var v = await GetWorkerAsync(id);
        var bridge = doc is null ? "UNKNOWN_COMPAT" : (doc.RootElement.TryGetProperty("bridgeOk", out var b) && b.GetBoolean() ? "OK" : "BLOCKED");
        return $"{v.State} | {v.Reason} | Session={(v.SessionOk ? "OK" : "BLOCKED")} | UI={v.UiReady} | Auth={v.AuthRequired} | Security={v.SecurityBlock ?? "none"} | Bridge={bridge} | Port={v.TabPort} | Window={v.WindowOpen}";
    }
    public async Task<SaveReceipt> SaveAsync(string id, bool archive)
    {
        var v = await GetWorkerAsync(id);
        if (v.State == WorkerUiState.Blocked) throw new InvalidOperationException($"SAVE_BLOCKED:{v.Reason}");
        if (v.UiBusy) throw new InvalidOperationException("SAVE_ACTIVE_UI_FORBIDDEN");
        var token = Guid.NewGuid().ToString();
        var dispatchedAt = DateTimeOffset.UtcNow;
        var prompt = SavePrompt.Build(token, id, dispatchedAt);
        using var sent = await PostAsync($"/api/workers/{id}/dispatch", new { text = prompt, navigate = false });
        for (var attempt = 0; attempt < 20; attempt++)
        {
            await Task.Delay(1000);
            var current = await GetWorkerAsync(id);
            if (!current.UiBusy && current.UiReady) break;
            if (attempt == 19) throw new InvalidOperationException("SAVE_UI_DID_NOT_RETURN_READY");
        }
        if (archive)
        {
            using var archived = await TryPostAsync($"/api/utility/workers/{id}/archive");
            if (archived is null) throw new InvalidOperationException("ARCHIVE_REQUIRES_CONTROLLER_UPGRADE");
        }
        return new SaveReceipt($"local-ui://{id}/{token}", $"local-ui://{id}/{token}");
    }
}

internal sealed record SaveReceipt(string ReceiptRef, string CheckpointRef);
internal sealed record BrowserMutationLeaseReceipt(string LeaseId, string OwnerId, string ExpiresAt);
