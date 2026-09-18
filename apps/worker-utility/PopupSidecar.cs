namespace TigerIQ.WorkerUtility;

internal static class PopupSidecar
{
    public static void ShowWorker(this PopupForm popup, WorkerDefinition worker, WorkerView view, WatchdogView? watchdog,
        WorkerSettings settings, ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Rectangle anchor)
    {
        var workerIndex = Array.FindIndex(Workers.All, x => x.Id == worker.Id);
        var working = Screen.FromRectangle(anchor).WorkingArea;
        var defaultLocation = UiPlacement.DockedPopup(workerIndex, Workers.All.Length, popup.Size, working);
        popup.ShowWorker(worker, view, watchdog, settings, scheduleSettings, doNotDisturb, recentLogs, defaultLocation, working);
    }
}
