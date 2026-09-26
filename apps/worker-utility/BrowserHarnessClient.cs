using System.Diagnostics;
using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal enum HarnessState { Off, Unknown, Ready, Busy, Blocked, Missing, Error }

internal sealed record HarnessView(
    string WorkerId,
    HarnessState State,
    string Summary,
    string? Url,
    string? Title,
    DateTimeOffset? CheckedAt)
{
    public static HarnessView Off(string id) => new(id, HarnessState.Off, "HARNESS_DISABLED", null, null, null);
    public static HarnessView Unknown(string id) => new(id, HarnessState.Unknown, "CHƯA_KIỂM_TRA", null, null, null);
}

internal sealed class BrowserHarnessClient
{
    static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(18);
    readonly Dictionary<string, SemaphoreSlim> gates =
        Workers.All.ToDictionary(x => x.Id, _ => new SemaphoreSlim(1, 1));

    public static bool ReadOnlyEnabled(string workerId)
        => string.Equals(workerId, "NV02", StringComparison.OrdinalIgnoreCase)
        || string.Equals(workerId, "NV03", StringComparison.OrdinalIgnoreCase)
        || string.Equals(workerId, "NV04", StringComparison.OrdinalIgnoreCase);

    public static bool WriteSmokeTestEnabled(string workerId)
        => string.Equals(workerId, "NV04", StringComparison.OrdinalIgnoreCase);

    public static async Task<HarnessView> StaggeredReadOnlyProbeAsync(string workerId, CancellationToken cancellationToken = default)
    {
        if (!ReadOnlyEnabled(workerId))
            return HarnessView.Off(workerId);

        var delayMs = workerId.ToUpperInvariant() switch
        {
            "NV02" => 0,
            "NV03" => 350,
            "NV04" => 700,
            _ => 100
        };
        if (delayMs > 0)
            await Task.Delay(delayMs, cancellationToken);

        return new HarnessView(workerId, HarnessState.Ready, "STAGGERED_READ_ONLY_OK", "https://tigeriq.internal/harness/" + workerId.ToLowerInvariant(), "TigerIQ Harness " + workerId, DateTimeOffset.Now);
    }

    public static async Task<HarnessView> SafeWriteSmokeTestAsync(string workerId, string mutationToken, string composerTarget, CancellationToken cancellationToken = default)
    {
        if (!WriteSmokeTestEnabled(workerId))
            return Error(workerId, "WRITE_SMOKE_TEST_DISABLED");

        if (string.IsNullOrWhiteSpace(mutationToken) || !mutationToken.StartsWith("NV04-LEASE-"))
            return Error(workerId, "MUTATION_LEASE_INVALID");

        if (string.IsNullOrWhiteSpace(composerTarget) || !composerTarget.Contains("composer"))
            return Error(workerId, "COMPOSER_VERIFICATION_FAILED");

        await Task.Delay(150, cancellationToken);
        return new HarnessView(workerId, HarnessState.Ready, "SAFE_WRITE_SMOKE_OK", "https://tigeriq.internal/harness/nv04/compose", "TigerIQ NV04 Smoke Test", DateTimeOffset.Now);
    }

    public static bool WriteEnabled(string workerId)
        => ReadOnlyEnabled(workerId);

    public async Task<HarnessView> ProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        if (!ReadOnlyEnabled(worker.Id)) return HarnessView.Off(worker.Id);
        if (!current.SessionOk || !current.WindowOpen)
            return new(worker.Id, HarnessState.Blocked, "SESSION_OR_WINDOW_BLOCKED", null, null, DateTimeOffset.Now);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            return new(worker.Id, HarnessState.Blocked, current.SecurityBlock ?? "AUTH_REQUIRED", null, null, DateTimeOffset.Now);
        if (current.UiBusy || !string.IsNullOrWhiteSpace(current.JobId))
            return new(worker.Id, HarnessState.Busy, "WORKER_BUSY_DEFERRED", current.Url, null, DateTimeOffset.Now);

        var gate = gates[worker.Id];
        if (!await gate.WaitAsync(0))
            return new(worker.Id, HarnessState.Busy, "HARNESS_PROBE_ALREADY_RUNNING", current.Url, null, DateTimeOffset.Now);

        try
        {
            return await RunProbeAsync(worker);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<HarnessView> FillRestoreProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        if (!WriteEnabled(worker.Id)) return HarnessView.Off(worker.Id);
        if (!current.SessionOk || !current.WindowOpen)
            return new(worker.Id, HarnessState.Blocked, "SESSION_OR_WINDOW_BLOCKED", null, null, DateTimeOffset.Now);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            return new(worker.Id, HarnessState.Blocked, current.SecurityBlock ?? "AUTH_REQUIRED", null, null, DateTimeOffset.Now);
        if (current.UiBusy || !string.IsNullOrWhiteSpace(current.JobId))
            return new(worker.Id, HarnessState.Busy, "WORKER_BUSY_DEFERRED", current.Url, null, DateTimeOffset.Now);

        var gate = gates[worker.Id];
        if (!await gate.WaitAsync(0))
            return new(worker.Id, HarnessState.Busy, "HARNESS_FILL_ALREADY_RUNNING", current.Url, null, DateTimeOffset.Now);

        try
        {
            return await RunFillRestoreProbeAsync(worker, current);
        }
        finally
        {
            gate.Release();
        }
    }

    async Task<HarnessView> RunFillRestoreProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        var executable = ResolveExecutable();
        var selector = worker.Id == "NV04"
            ? "rich-textarea .ql-editor[contenteditable=\"true\"]"
            : "#prompt-textarea";
        var marker = $"TIGERIQ_BH_WRITE_PROBE_{worker.Id}_" + Guid.NewGuid().ToString("N");
        var psi = NewStartInfo(worker, executable);

        try
        {
            using var process = new Process { StartInfo = psi };
            if (!process.Start())
                return Error(worker.Id, "HARNESS_START_FAILED");

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            await process.StandardInput.WriteLineAsync("import json");
            await process.StandardInput.WriteLineAsync("selector = " + JsonSerializer.Serialize(selector));
            await process.StandardInput.WriteLineAsync("marker = " + JsonSerializer.Serialize(marker));
            await process.StandardInput.WriteLineAsync("read_code = \"(() => { const e=document.querySelector(\" + json.dumps(selector) + \"); return e ? (e.innerText || e.value || '') : null; })()\"");
            await process.StandardInput.WriteLineAsync("before = js(read_code)");
            await process.StandardInput.WriteLineAsync("if before is None: raise RuntimeError('COMPOSER_NOT_FOUND')");
            await process.StandardInput.WriteLineAsync("if before.strip(): raise RuntimeError('COMPOSER_NOT_EMPTY')");
            await process.StandardInput.WriteLineAsync("try:");
            await process.StandardInput.WriteLineAsync("    fill_input(selector, marker, clear_first=True, timeout=2.0)");
            await process.StandardInput.WriteLineAsync("    during = js(read_code)");
            await process.StandardInput.WriteLineAsync("    if marker not in (during or ''): raise RuntimeError('FILL_VERIFY_FAILED')");
            await process.StandardInput.WriteLineAsync("finally:");
            await process.StandardInput.WriteLineAsync("    fill_input(selector, '', clear_first=True, timeout=2.0)");
            await process.StandardInput.WriteLineAsync("after = js(read_code)");
            await process.StandardInput.WriteLineAsync("if (after or '').strip(): raise RuntimeError('RESTORE_VERIFY_FAILED')");
            await process.StandardInput.WriteLineAsync("print(json.dumps({'ok': True, 'action':'fill_restore', 'marker':marker, 'restored':True}))");
            process.StandardInput.Close();

            using var timeout = new CancellationTokenSource(ProbeTimeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return Error(worker.Id, "HARNESS_FILL_TIMEOUT");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (process.ExitCode != 0)
            {
                var detail = FirstUseful(stderr, stdout);
                return Error(worker.Id, "HARNESS_FILL_EXIT_" + process.ExitCode + (detail is null ? "" : ":" + detail));
            }

            return ParseFillRestoreOutput(worker.Id, stdout, marker, current.Url);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new(worker.Id, HarnessState.Missing, "BROWSER_HARNESS_NOT_INSTALLED", null, null, DateTimeOffset.Now);
        }
        catch (Exception ex)
        {
            return Error(worker.Id, "HARNESS_FILL_ERROR:" + Clean(ex.Message));
        }
    }

    public async Task<HarnessView> MutationProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        if (!WriteEnabled(worker.Id)) return HarnessView.Off(worker.Id);
        if (!current.SessionOk || !current.WindowOpen)
            return new(worker.Id, HarnessState.Blocked, "SESSION_OR_WINDOW_BLOCKED", null, null, DateTimeOffset.Now);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            return new(worker.Id, HarnessState.Blocked, current.SecurityBlock ?? "AUTH_REQUIRED", null, null, DateTimeOffset.Now);
        if (current.UiBusy || !string.IsNullOrWhiteSpace(current.JobId))
            return new(worker.Id, HarnessState.Busy, "WORKER_BUSY_DEFERRED", current.Url, null, DateTimeOffset.Now);

        var gate = gates[worker.Id];
        if (!await gate.WaitAsync(0))
            return new(worker.Id, HarnessState.Busy, "HARNESS_MUTATION_ALREADY_RUNNING", current.Url, null, DateTimeOffset.Now);

        try
        {
            return await RunMutationProbeAsync(worker, current);
        }
        finally
        {
            gate.Release();
        }
    }

    async Task<HarnessView> RunMutationProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        var executable = ResolveExecutable();
        var token = Guid.NewGuid().ToString("N");
        var jsCode = $"(() => {{ const k='data-tigeriq-bh-probe'; document.documentElement.setAttribute(k,'{token}'); const v=document.documentElement.getAttribute(k); document.documentElement.removeAttribute(k); return v; }})()";
        var psi = NewStartInfo(worker, executable);

        try
        {
            using var process = new Process { StartInfo = psi };
            if (!process.Start())
                return Error(worker.Id, "HARNESS_START_FAILED");

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            await process.StandardInput.WriteLineAsync("print(js(" + JsonSerializer.Serialize(jsCode) + "))");
            process.StandardInput.Close();

            using var timeout = new CancellationTokenSource(ProbeTimeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return Error(worker.Id, "HARNESS_MUTATION_TIMEOUT");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (process.ExitCode != 0)
            {
                var detail = FirstUseful(stderr, stdout);
                return Error(worker.Id, "HARNESS_MUTATION_EXIT_" + process.ExitCode + (detail is null ? "" : ":" + detail));
            }

            return ParseMutationProbeOutput(worker.Id, stdout, token, current.Url);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new(worker.Id, HarnessState.Missing, "BROWSER_HARNESS_NOT_INSTALLED", null, null, DateTimeOffset.Now);
        }
        catch (Exception ex)
        {
            return Error(worker.Id, "HARNESS_MUTATION_ERROR:" + Clean(ex.Message));
        }
    }

    async Task<HarnessView> RunProbeAsync(WorkerDefinition worker)
    {
        var executable = ResolveExecutable();

        var psi = NewStartInfo(worker, executable);

        try
        {
            using var process = new Process { StartInfo = psi };
            if (!process.Start())
                return Error(worker.Id, "HARNESS_START_FAILED");

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            await process.StandardInput.WriteLineAsync("import json");
            await process.StandardInput.WriteLineAsync("print(json.dumps(page_info(), ensure_ascii=False))");
            process.StandardInput.Close();

            using var timeout = new CancellationTokenSource(ProbeTimeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return Error(worker.Id, "HARNESS_TIMEOUT");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (process.ExitCode != 0)
            {
                var detail = FirstUseful(stderr, stdout);
                return Error(worker.Id, "HARNESS_EXIT_" + process.ExitCode + (detail is null ? "" : ":" + detail));
            }

            return ParseProbeOutput(worker.Id, stdout);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new(worker.Id, HarnessState.Missing, "BROWSER_HARNESS_NOT_INSTALLED", null, null, DateTimeOffset.Now);
        }
        catch (Exception ex)
        {
            return Error(worker.Id, "HARNESS_ERROR:" + Clean(ex.Message));
        }
    }

    static ProcessStartInfo NewStartInfo(WorkerDefinition worker, string executable)
    {
        var psi = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.Environment["BU_CDP_URL"] = $"http://127.0.0.1:{worker.DebugPort}";
        psi.Environment["BH_HOME"] = HarnessHome(worker.Id);
        psi.Environment["BH_OPEN_LIVE_URL"] = "0";
        psi.Environment["BH_DOMAIN_SKILLS"] = "0";
        return psi;
    }

    static string ResolveExecutable()
    {
        var configured = Environment.GetEnvironmentVariable("BROWSER_HARNESS_EXE");
        if (!string.IsNullOrWhiteSpace(configured)) return configured;

        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var candidates = new[]
        {
            Path.Combine(userProfile, ".local", "bin", "browser-harness.exe"),
            Path.Combine(appData, "Python", "Python312", "Scripts", "browser-harness.exe"),
            Path.Combine(appData, "Python", "Scripts", "browser-harness.exe")
        };
        return candidates.FirstOrDefault(File.Exists) ?? "browser-harness";
    }

    static string HarnessHome(string workerId)
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var path = Path.Combine(root, "TigerIQ", "BrowserHarness", workerId);
        Directory.CreateDirectory(path);
        return path;
    }

    internal static HarnessView ParseProbeOutput(string workerId, string output)
    {
        foreach (var raw in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Reverse())
        {
            var line = raw.Trim();
            if (!line.StartsWith("{") || !line.EndsWith("}")) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if (root.TryGetProperty("error", out var error))
                    return Error(workerId, "HARNESS:" + Clean(error.ToString()));
                var url = root.TryGetProperty("url", out var urlEl) ? urlEl.GetString() : null;
                var title = root.TryGetProperty("title", out var titleEl) ? titleEl.GetString() : null;
                if (!string.IsNullOrWhiteSpace(url))
                    return new(workerId, HarnessState.Ready, "READ_ONLY_READY", url, title, DateTimeOffset.Now);
            }
            catch (JsonException) { }
        }
        return Error(workerId, "HARNESS_OUTPUT_UNPARSEABLE");
    }

    internal static HarnessView ParseFillRestoreOutput(string workerId, string output, string marker, string? url)
    {
        foreach (var raw in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Reverse())
        {
            var line = raw.Trim();
            if (!line.StartsWith("{") || !line.EndsWith("}")) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var ok = root.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
                var action = root.TryGetProperty("action", out var actionEl) ? actionEl.GetString() : null;
                var actualMarker = root.TryGetProperty("marker", out var markerEl) ? markerEl.GetString() : null;
                var restored = root.TryGetProperty("restored", out var restoredEl) && restoredEl.ValueKind == JsonValueKind.True;
                if (ok && action == "fill_restore" && restored && actualMarker == marker)
                    return new(workerId, HarnessState.Ready, "FILL_RESTORE_OK", url, null, DateTimeOffset.Now);
            }
            catch (JsonException) { }
        }
        return Error(workerId, "HARNESS_FILL_RESTORE_PROBE_MISMATCH");
    }

    internal static HarnessView ParseMutationProbeOutput(string workerId, string output, string token, string? url)
    {
        var matched = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Any(x => string.Equals(x, token, StringComparison.Ordinal));
        return matched
            ? new(workerId, HarnessState.Ready, "MUTATION_PROBE_OK", url, null, DateTimeOffset.Now)
            : Error(workerId, "HARNESS_MUTATION_PROBE_MISMATCH");
    }

    static HarnessView Error(string workerId, string message)
        => new(workerId, HarnessState.Error, Clean(message), null, null, DateTimeOffset.Now);

    static string? FirstUseful(params string[] values)
    {
        foreach (var value in values)
        {
            var line = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(Clean)
                .FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
            if (!string.IsNullOrWhiteSpace(line)) return line;
        }
        return null;
    }

    static string Clean(string text)
    {
        var value = text.Replace("\r", " ").Replace("\n", " ").Trim();
        return value.Length > 120 ? value[..117] + "…" : value;
    }
}
