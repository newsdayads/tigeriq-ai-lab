namespace TigerIQ.WorkerUtility;

internal sealed record WorkerObservabilityView(
    string Current,
    string Result,
    string LastActivity,
    string Next,
    string Browser);

internal static class WorkerObservability
{
    public static WorkerObservabilityView Build(
        WorkerView view,
        HarnessView? harness,
        WorkerSettings settings,
        ScheduleSettings? schedule,
        string[] recentLogs)
    {
        return new(
            CurrentText(view),
            ResultText(view, harness, recentLogs),
            LastActivityText(view, harness, settings),
            NextText(view, harness, schedule),
            BrowserText(harness));
    }

    internal static string CurrentText(WorkerView view) => view.State switch
    {
        WorkerUiState.Working when !string.IsNullOrWhiteSpace(view.JobId) =>
            $"{Short(view.JobTitle ?? view.JobId, 28)} · {StageText(view.JobStage)}{ProgressText(view.JobProgress)}",
        WorkerUiState.Working => "Đang xử lý trên web",
        WorkerUiState.Paused => "Đang tạm dừng",
        WorkerUiState.Blocked => $"Bị chặn · {Short(view.Reason, 42)}",
        _ when !string.IsNullOrWhiteSpace(view.JobStage) => $"{StageText(view.JobStage)}{ProgressText(view.JobProgress)}",
        _ => "Chờ việc mới"
    };

    internal static string NextText(WorkerView view, HarnessView? harness, ScheduleSettings? schedule)
    {
        if (!string.IsNullOrWhiteSpace(view.JobNextAction)) return Short(view.JobNextAction, 48);
        if (view.State == WorkerUiState.Blocked) return "Xử lý blocker";
        if (view.State == WorkerUiState.Paused) return "Bấm Chạy/Tiếp tục";
        if (harness?.State is HarnessState.Error or HarnessState.Missing or HarnessState.Blocked)
            return "Kiểm tra Harness";
        if (view.State == WorkerUiState.Working) return "Theo dõi đến khi hoàn tất";
        if (schedule?.Enabled == true && schedule.NextCheckAt is DateTimeOffset next)
            return $"Kiểm tra {next.ToLocalTime():HH:mm}";
        return "Chờ việc mới";
    }

    internal static string BrowserText(HarnessView? harness) => harness?.State switch
    {
        HarnessState.Ready when string.Equals(harness.Summary, "FILL_RESTORE_OK", StringComparison.OrdinalIgnoreCase) => "BH:WRITE OK",
        HarnessState.Ready => "BH:OK",
        HarnessState.Busy => "BH:BẬN",
        HarnessState.Blocked => "BH:CHẶN",
        HarnessState.Missing => "BH:THIẾU",
        HarnessState.Error => "BH:LỖI",
        HarnessState.Unknown => "BH:?",
        _ => "BH:—"
    };

    static string ResultText(WorkerView view, HarnessView? harness, string[] logs)
    {
        if (!string.IsNullOrWhiteSpace(view.JobResult))
            return Short(view.JobResult, 46);
        if (!string.IsNullOrWhiteSpace(view.JobEvidenceRef))
            return $"Evidence · {Short(view.JobEvidenceRef, 35)}";
        if (view.State == WorkerUiState.Blocked)
            return $"Bị chặn · {Short(view.Reason, 46)}";

        for (var i = logs.Length - 1; i >= 0; i--)
        {
            var line = logs[i];
            if (line.Contains("HARNESS_FILL_RESTORE_RESULT", StringComparison.OrdinalIgnoreCase))
                return "Harness write-safe PASS";
            if (line.Contains("RECOVERY_END", StringComparison.OrdinalIgnoreCase))
                return "Khôi phục đã hoàn tất";
            if (line.Contains("WATCHDOG_FAIL_CLOSED", StringComparison.OrdinalIgnoreCase))
                return "Watchdog đã dừng an toàn";
            if (line.Contains("WATCHDOG_BLOCKED", StringComparison.OrdinalIgnoreCase)
                || line.Contains("ACTION_ERROR", StringComparison.OrdinalIgnoreCase))
                return "Có lỗi · xem log";
            if (line.Contains("ACTION_OK", StringComparison.OrdinalIgnoreCase))
                return ActionResult(line);
        }

        return harness?.State switch
        {
            HarnessState.Ready => "Web kiểm tra PASS",
            HarnessState.Busy => "Harness đang bận",
            HarnessState.Blocked => "Harness bị chặn",
            HarnessState.Missing => "Chưa có Browser Harness",
            HarnessState.Error => "Harness lỗi · xem log",
            _ => view.State == WorkerUiState.Working ? "Đang xử lý" : "Chưa có kết quả mới"
        };
    }

    static string ActionResult(string line)
    {
        var action = ExtractAction(line);
        return action switch
        {
            "save" => "Đã lưu checkpoint",
            "save-archive" => "Đã lưu & lưu trữ",
            "recover" => "Khôi phục hoàn tất",
            "harness-lock-test" => "Harness write-safe PASS",
            "harness-probe" => "Harness kiểm tra PASS",
            "run" => "Đã tiếp tục",
            "pause" => "Đã tạm dừng",
            "open" => "Đã mở đúng trang",
            "fix" => "Đã về đúng vị trí",
            _ => "Thao tác APP hoàn tất"
        };
    }

    static string? ExtractAction(string line)
    {
        const string marker = "\"action\":\"";
        var start = line.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (start < 0) return null;
        start += marker.Length;
        var end = line.IndexOf('"', start);
        return end > start ? line[start..end] : null;
    }

    static string LastActivityText(WorkerView view, HarnessView? harness, WorkerSettings settings)
    {
        DateTimeOffset? latest = null;
        static void Take(ref DateTimeOffset? target, DateTimeOffset? value)
        {
            if (value is not DateTimeOffset at) return;
            if (target is null || at > target.Value) target = at;
        }

        Take(ref latest, view.HeartbeatAt);
        Take(ref latest, view.JobLastActivityAt);
        Take(ref latest, harness?.CheckedAt);
        Take(ref latest, settings.StateChangedAt);
        return latest?.ToLocalTime().ToString("HH:mm:ss") ?? "—";
    }

    static string ProgressText(int? progress) => progress is int p ? $" · {Math.Clamp(p, 0, 100)}%" : "";

    static string StageText(string? stage) => stage switch
    {
        "QUEUED" => "Đã xếp hàng",
        "DISPATCHING" => "Đang giao việc",
        "SUBMITTED" => "Đã giao",
        "WORKING" => "Đang làm",
        "WAITING_EVIDENCE" => "Chờ bằng chứng",
        "VERIFY" => "Đang xác minh",
        "DONE" => "Hoàn tất",
        "BLOCKED" => "Bị chặn",
        "ERROR" => "Lỗi",
        _ => string.IsNullOrWhiteSpace(stage) ? "Đang xử lý" : stage
    };

    static string Short(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return "không rõ";
        var value = text.Replace("\r", " ").Replace("\n", " ").Trim();
        return value.Length <= max ? value : value[..Math.Max(1, max - 1)] + "…";
    }
}
