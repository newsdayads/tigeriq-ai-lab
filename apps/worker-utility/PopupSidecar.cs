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
        popup.ShowWorker(worker, view, watchdog, settings, scheduleSettings, null, doNotDisturb, recentLogs, anchor, occupied.ToArray());
    }
}
