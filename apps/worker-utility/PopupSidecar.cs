namespace TigerIQ.WorkerUtility;

internal static class PopupSidecar
{
    public static void ShowWorker(this PopupForm popup, WorkerDefinition worker, WorkerView view, WatchdogView? watchdog,
        WorkerSettings settings, ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Rectangle anchor)
    {
        var binder = new WindowBinder();
        var occupied = new List<Rectangle>();
        foreach (var item in Workers.All)
            if (binder.TryResolve(item.Id, out _, out var rect) && rect.Width > 0 && rect.Height > 0)
                occupied.Add(rect);

        if (!occupied.Any(r => r == anchor)) occupied.Add(anchor);
        if (popup.ShowWorker(worker, view, watchdog, settings, scheduleSettings, doNotDisturb, recentLogs, anchor, occupied.ToArray())) return;

        MessageBox.Show(
            "Không có vùng trống an toàn để mở bảng điều khiển mà không che cửa sổ Chrome. Hãy dùng 'Về vị trí' hoặc chuyển một cửa sổ sang vùng trống rồi mở lại.",
            "TigerIQ — Không chồng cửa sổ",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }
}
