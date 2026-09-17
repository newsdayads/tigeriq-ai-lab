using Microsoft.Win32;
using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal sealed class StateStore
{
    readonly string root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TigerIQ", "WorkerUtility");
    readonly string statePath;
    readonly string logPath;
    readonly JsonSerializerOptions json = new() { WriteIndented = true };

    public StateStore()
    {
        Directory.CreateDirectory(root);
        statePath = Path.Combine(root, "state.json");
        logPath = Path.Combine(root, "worker-utility.jsonl");
    }

    public UtilitySettings Load()
    {
        try
        {
            if (File.Exists(statePath))
                return JsonSerializer.Deserialize<UtilitySettings>(File.ReadAllText(statePath))
                    ?? UtilitySettings.CreateDefault();
        }
        catch { }
        return UtilitySettings.CreateDefault();
    }

    public void Save(UtilitySettings value)
    {
        var tmp = statePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, json));
        File.Move(tmp, statePath, true);
    }

    public void Log(string workerId, string eventName, object? detail = null)
    {
        var row = JsonSerializer.Serialize(new
        {
            ts = DateTimeOffset.Now,
            workerId,
            @event = eventName,
            detail
        });
        File.AppendAllText(logPath, row + Environment.NewLine);
    }

    public string[] RecentLogs(int max = 10)
    {
        if (!File.Exists(logPath)) return [];
        return File.ReadLines(logPath).Reverse().Take(max).Reverse().ToArray();
    }

    public string[] RecentLogs(string workerId, int max = 10)
    {
        if (!File.Exists(logPath)) return [];
        return File.ReadLines(logPath)
            .Reverse()
            .Where(line => MatchesWorker(line, workerId))
            .Take(max)
            .Reverse()
            .Select(FormatLogLine)
            .ToArray();
    }

    static bool MatchesWorker(string line, string workerId)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            return doc.RootElement.TryGetProperty("workerId", out var id)
                && string.Equals(id.GetString(), workerId, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    static string FormatLogLine(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            var ts = root.TryGetProperty("ts", out var t) && DateTimeOffset.TryParse(t.GetString(), out var parsed)
                ? parsed.ToLocalTime().ToString("HH:mm:ss")
                : "--:--:--";
            var evt = root.TryGetProperty("event", out var e) ? e.GetString() ?? "EVENT" : "EVENT";
            var detail = root.TryGetProperty("detail", out var d) && d.ValueKind is not JsonValueKind.Null
                ? d.ToString()
                : "";
            return string.IsNullOrWhiteSpace(detail) ? $"{ts}  {evt}" : $"{ts}  {evt}  {detail}";
        }
        catch { return line; }
    }

    public void EnsureAutostart()
    {
        using var key = Registry.CurrentUser.CreateSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run");
        key.SetValue("TigerIQ Worker Utility", $"\"{Application.ExecutablePath}\"");
    }
}
