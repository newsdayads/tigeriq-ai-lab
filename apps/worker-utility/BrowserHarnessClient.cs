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

internal sealed record HarnessWriteSmokeResult(bool Ok, string Status, string? Url, string? Title);

internal sealed class BrowserHarnessClient
{
    public const string WritePilotWorkerId = "NV04";
    static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(18);
    static readonly TimeSpan WriteSmokeTimeout = TimeSpan.FromSeconds(18);
    readonly Dictionary<string, SemaphoreSlim> gates =
        Workers.All.ToDictionary(x => x.Id, _ => new SemaphoreSlim(1, 1));

    const string ComposerStateJs = """
(()=>{const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
const sels=location.hostname==='chatgpt.com'
?['#prompt-textarea','div[contenteditable="true"][data-lexical-editor="true"]','[contenteditable="true"][role="textbox"]','textarea']
:['rich-textarea .ql-editor[contenteditable="true"]','.ql-editor[contenteditable="true"]','[contenteditable="true"][role="textbox"]','textarea'];
let e=null;for(const s of sels){e=[...document.querySelectorAll(s)].find(vis);if(e)break;}
if(!e)return {ok:false,status:'COMPOSER_NOT_FOUND'};
e.focus();const text=('value' in e?e.value:(e.innerText||e.textContent||'')).replace(/\u200b/g,'');
return {ok:true,status:'COMPOSER_READY',empty:text.trim().length===0,text};})()
""";

    public static bool ReadOnlyEnabled(string workerId) => Workers.All.Any(w => w.Id == workerId);
    public static bool WritePilotEnabled(string workerId)
        => string.Equals(workerId, WritePilotWorkerId, StringComparison.OrdinalIgnoreCase);

    public async Task<HarnessView> ProbeAsync(WorkerDefinition worker, WorkerView current)
    {
        if (!ReadOnlyEnabled(worker.Id)) return HarnessView.Off(worker.Id);
        var blocked = ValidateWorker(worker, current);
        if (blocked is not null) return blocked;

        var gate = gates[worker.Id];
        if (!await gate.WaitAsync(0))
            return new(worker.Id, HarnessState.Busy, "HARNESS_ACTION_ALREADY_RUNNING", current.Url, null, DateTimeOffset.Now);

        try
        {
            var run = await RunHarnessAsync(worker,
                ["import json", "print(json.dumps(page_info(), ensure_ascii=False))"], ProbeTimeout);
            if (run.TimedOut) return Error(worker.Id, "HARNESS_TIMEOUT");
            if (run.ExitCode != 0)
            {
                var detail = FirstUseful(run.Stderr, run.Stdout);
                return Error(worker.Id, "HARNESS_EXIT_" + run.ExitCode + (detail is null ? "" : ":" + detail));
            }
            return ParseProbeOutput(worker.Id, run.Stdout);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new(worker.Id, HarnessState.Missing, "BROWSER_HARNESS_NOT_INSTALLED", null, null, DateTimeOffset.Now);
        }
        catch (Exception ex)
        {
            return Error(worker.Id, "HARNESS_ERROR:" + Clean(ex.Message));
        }
        finally { gate.Release(); }
    }

    public async Task<HarnessWriteSmokeResult> WriteSmokeAsync(WorkerDefinition worker, WorkerView current)
    {
        if (!WritePilotEnabled(worker.Id))
            return new(false, "WRITE_PILOT_NV04_ONLY", current.Url, null);
        var blocked = ValidateWorker(worker, current);
        if (blocked is not null)
            return new(false, blocked.Summary, current.Url, blocked.Title);

        var gate = gates[worker.Id];
        if (!await gate.WaitAsync(0))
            return new(false, "HARNESS_ACTION_ALREADY_RUNNING", current.Url, null);

        var marker = "TIGERIQ_HARNESS_SMOKE_" + Guid.NewGuid().ToString("N")[..8];
        try
        {
            var jsLiteral = JsonSerializer.Serialize(ComposerStateJs);
            var markerLiteral = JsonSerializer.Serialize(marker);
            var script = new[]
            {
                "import json,time",
                $"state_js={jsLiteral}",
                $"marker={markerLiteral}",
                "before=js(state_js)",
                "result={'ok':False,'status':before.get('status','COMPOSER_CHECK_FAILED')}",
                "if before.get('ok') and before.get('empty'):",
                "    type_text(marker)",
                "    time.sleep(0.2)",
                "    typed=js(state_js)",
                "    typed_ok=typed.get('text','')==marker",
                "    press_key('a', modifiers=2)",
                "    press_key('Backspace')",
                "    time.sleep(0.1)",
                "    cleared=js(state_js)",
                "    clear_ok=bool(cleared.get('empty'))",
                "    info=page_info()",
                "    result={'ok':bool(typed_ok and clear_ok),'status':'WRITE_SMOKE_OK' if typed_ok and clear_ok else 'WRITE_SMOKE_VERIFY_FAILED','typed':typed_ok,'cleared':clear_ok,'url':info.get('url'),'title':info.get('title')}",
                "elif before.get('ok'):",
                "    info=page_info()",
                "    result={'ok':False,'status':'COMPOSER_NOT_EMPTY','url':info.get('url'),'title':info.get('title')}",
                "print(json.dumps(result, ensure_ascii=False))"
            };
            var run = await RunHarnessAsync(worker, script, WriteSmokeTimeout);
            if (run.TimedOut) return new(false, "HARNESS_WRITE_TIMEOUT", current.Url, null);
            if (run.ExitCode != 0)
                return new(false, "HARNESS_WRITE_EXIT_" + run.ExitCode + ":" + (FirstUseful(run.Stderr, run.Stdout) ?? "UNKNOWN"), current.Url, null);
            return ParseWriteSmokeOutput(run.Stdout);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new(false, "BROWSER_HARNESS_NOT_INSTALLED", current.Url, null);
        }
        catch (Exception ex)
        {
            return new(false, "HARNESS_WRITE_ERROR:" + Clean(ex.Message), current.Url, null);
        }
        finally { gate.Release(); }
    }

    static HarnessView? ValidateWorker(WorkerDefinition worker, WorkerView current)
    {
        if (!current.SessionOk || !current.WindowOpen)
            return new(worker.Id, HarnessState.Blocked, "SESSION_OR_WINDOW_BLOCKED", null, null, DateTimeOffset.Now);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            return new(worker.Id, HarnessState.Blocked, current.SecurityBlock ?? "AUTH_REQUIRED", null, null, DateTimeOffset.Now);
        if (current.UiBusy || !string.IsNullOrWhiteSpace(current.JobId))
            return new(worker.Id, HarnessState.Busy, "WORKER_BUSY_DEFERRED", current.Url, null, DateTimeOffset.Now);
        return null;
    }

    async Task<(int ExitCode, string Stdout, string Stderr, bool TimedOut)> RunHarnessAsync(
        WorkerDefinition worker, IEnumerable<string> script, TimeSpan timeout)
    {
        var psi = CreateStartInfo(worker);
        using var process = new Process { StartInfo = psi };
        if (!process.Start()) throw new InvalidOperationException("HARNESS_START_FAILED");

        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        foreach (var line in script) await process.StandardInput.WriteLineAsync(line);
        process.StandardInput.Close();

        using var cts = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            return (-1, await stdoutTask, await stderrTask, true);
        }
        return (process.ExitCode, await stdoutTask, await stderrTask, false);
    }

    static ProcessStartInfo CreateStartInfo(WorkerDefinition worker)
    {
        var psi = new ProcessStartInfo
        {
            FileName = ResolveExecutable(),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.Environment["BU_CDP_URL"] = $"http://127.0.0.1:{worker.DebugPort}";
        psi.Environment["BU_NAME"] = "tigeriq-" + worker.Id.ToLowerInvariant();
        psi.Environment["BH_HOME"] = HarnessHome(worker.Id);
        psi.Environment["BH_OPEN_LIVE_URL"] = "0";
        psi.Environment["BH_DOMAIN_SKILLS"] = "0";
        psi.Environment["BH_TAB_MARKER"] = "0";
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
        foreach (var raw in JsonLines(output))
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
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

    internal static HarnessWriteSmokeResult ParseWriteSmokeOutput(string output)
    {
        foreach (var raw in JsonLines(output))
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (!root.TryGetProperty("status", out var statusEl)) continue;
                var ok = root.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
                var status = statusEl.GetString() ?? "WRITE_SMOKE_UNKNOWN";
                var url = root.TryGetProperty("url", out var urlEl) ? urlEl.GetString() : null;
                var title = root.TryGetProperty("title", out var titleEl) ? titleEl.GetString() : null;
                return new(ok, status, url, title);
            }
            catch (JsonException) { }
        }
        return new(false, "HARNESS_WRITE_OUTPUT_UNPARSEABLE", null, null);
    }

    static IEnumerable<string> JsonLines(string output)
        => output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.StartsWith("{") && x.EndsWith("}"))
            .Reverse();

    static HarnessView Error(string workerId, string message)
        => new(workerId, HarnessState.Error, Clean(message), null, null, DateTimeOffset.Now);

    static string? FirstUseful(params string[] values)
    {
        foreach (var value in values)
        {
            var line = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(Clean).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
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
