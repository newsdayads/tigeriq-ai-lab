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
    public static HarnessView Off(string id) => new(id, HarnessState.Off, "PILOT_NV04_ONLY", null, null, null);
    public static HarnessView Unknown(string id) => new(id, HarnessState.Unknown, "CHƯA_KIỂM_TRA", null, null, null);
}

internal sealed class BrowserHarnessClient
{
    public const string PilotWorkerId = "NV04";
    static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(18);
    readonly Dictionary<string, SemaphoreSlim> gates =
        Workers.All.ToDictionary(x => x.Id, _ => new SemaphoreSlim(1, 1));

    public static bool PilotEnabled(string workerId)
        => string.Equals(workerId, PilotWorkerId, StringComparison.OrdinalIgnoreCase);

    public async Task<HarnessView> ProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        if (!PilotEnabled(worker.Id)) return HarnessView.Off(worker.Id);
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

    async Task<HarnessView> RunProbeAsync(WorkerDefinition worker)
    {
        var executable = ResolveExecutable();

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
