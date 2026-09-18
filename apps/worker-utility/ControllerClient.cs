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
    const string ReceiptService = "http://127.0.0.1:8794";

    public async Task<(JsonDocument State, JsonDocument Autopilot)> RawStateAsync()
    {
        var state = await GetJsonAsync(Controller + "/api/state");
        var autopilot = await GetJsonAsync(Controller + "/api/autopilot/state");
        return (state, autopilot);
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
        var jobId = CurrentJob(auto.RootElement, workerId);
        WorkerUiState viewState;
        string reason;
        if (paused) { viewState = WorkerUiState.Paused; reason = "Controller paused"; }
        else if (!sessionOk) { viewState = WorkerUiState.Blocked; reason = "SESSION_MISMATCH"; }
        else if (blocked || auth || !string.IsNullOrWhiteSpace(sec)) { viewState = WorkerUiState.Blocked; reason = sec ?? (auth ? "AUTH_REQUIRED" : status); }
        else if (stale || !windowOpen || !uiReady) { viewState = WorkerUiState.Blocked; reason = stale ? "HEARTBEAT_STALE" : (!windowOpen ? "WINDOW_NOT_OPEN" : "UI_NOT_READY"); }
        else if (busy || !string.IsNullOrWhiteSpace(jobId)) { viewState = WorkerUiState.Working; reason = busy ? "UI_BUSY" : "JOB_ACTIVE"; }
        else { viewState = WorkerUiState.Ready; reason = "READY"; }
        return new WorkerView(workerId, viewState, reason, jobId, null, uiReady, auth, busy, sec, url,
            Workers.Get(workerId).DebugPort, hbAt, sessionOk, windowOpen);
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
        if (state.State == WorkerUiState.Working || state.UiBusy || !string.IsNullOrWhiteSpace(state.JobId))
            throw new InvalidOperationException("SAFE_CLOSE_ACTIVE_JOB_FORBIDDEN");
        if (state.State == WorkerUiState.Blocked && state.Reason != "WINDOW_NOT_OPEN")
            throw new InvalidOperationException($"SAFE_CLOSE_BLOCKED:{state.Reason}");
        return await PostAsync($"/api/workers/{id}/close");
    }

    public async Task OpenCanonicalAsync(string id)
    {
        var current = await GetWorkerAsync(id);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            throw new InvalidOperationException($"OPEN_CANONICAL_BLOCKED:{current.Reason}");

        // Approved utility behavior: if the worker is already in its canonical context,
        // do not reload/navigate it. A simple focus is enough and avoids UI_NOT_READY churn.
        if (current.WindowOpen && current.UiReady && IsCanonicalContext(id, current.Url))
        {
            using var focused = await FocusAsync(id);
            return;
        }

        using var response = await TryPostAsync($"/api/utility/workers/{id}/open-canonical");
        if (response is not null) return;

        current = await GetWorkerAsync(id);
        if (IsCanonicalContext(id, current.Url))
        {
            using var focused = await FocusAsync(id);
            return;
        }
        throw new InvalidOperationException("OPEN_CANONICAL_REQUIRES_CONTROLLER_UPGRADE");
    }
    static bool IsCanonicalContext(string id, string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        return id switch {
            "NV02" => url.Contains("g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab", StringComparison.OrdinalIgnoreCase),
            "NV03" => url.Contains("g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab", StringComparison.OrdinalIgnoreCase),
            "NV04" => url.Contains("gemini.google.com", StringComparison.OrdinalIgnoreCase),
            _ => false
        };
    }

    public async Task<bool> IsUtilityPausedAsync(string id)
    {
        using var doc = await TryGetJsonAsync(Controller + $"/api/utility/workers/{id}/health");
        if (doc is null) throw new InvalidOperationException("UTILITY_HEALTH_REQUIRES_CONTROLLER_UPGRADE");
        return doc.RootElement.TryGetProperty("utilityPaused", out var paused)
            && paused.ValueKind == JsonValueKind.True;
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
        if (v.UiBusy || !string.IsNullOrWhiteSpace(v.JobId)) throw new InvalidOperationException("SAVE_ACTIVE_MUTATION_FORBIDDEN");
        var token = Guid.NewGuid().ToString();
        var dispatchedAt = DateTimeOffset.UtcNow;
        var prompt = SavePrompt.Build(token, id, dispatchedAt);
        using var sent = await PostAsync($"/api/workers/{id}/dispatch", new { text = prompt, navigate = false });
        var receipt = await WaitReceiptAsync(token, id, dispatchedAt);
        if (archive)
        {
            using var archived = await TryPostAsync($"/api/utility/workers/{id}/archive", new { receiptRef = receipt.ReceiptRef });
            if (archived is null) throw new InvalidOperationException("ARCHIVE_REQUIRES_CONTROLLER_UPGRADE:DURABLE_RECEIPT_PRESERVED");
        }
        return receipt;
    }

    async Task<SaveReceipt> WaitReceiptAsync(string token, string id, DateTimeOffset after)
    {
        for (var attempt = 0; attempt < 12; attempt++)
        {
            if (attempt > 0) await Task.Delay(2000);
            var q = $"?token={Uri.EscapeDataString(token)}&workerId={id}&after={Uri.EscapeDataString(after.ToString("O"))}";
            using var doc = await GetJsonAsync(ReceiptService + "/api/ui-autopilot/save-receipt" + q);
            var r = doc.RootElement;
            if (r.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True
                && r.TryGetProperty("status", out var status) && status.GetString() == "DURABLE")
                return new SaveReceipt(r.GetProperty("receiptRef").GetString()!, r.GetProperty("checkpointRef").GetString()!);
        }
        throw new InvalidOperationException("SAVE_NOT_DURABLE");
    }
}

internal sealed record SaveReceipt(string ReceiptRef, string CheckpointRef);
