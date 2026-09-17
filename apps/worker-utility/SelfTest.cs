namespace TigerIQ.WorkerUtility;

internal static class SelfTest
{
    public static int Run()
    {
        try
        {
            TestWatchdog();
            TestSavePrompt();
            TestSettingsRoundTrip();
            TestUiPlacement();
            Console.WriteLine("SELF_TEST_OK");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("SELF_TEST_FAIL: " + ex.Message);
            return 1;
        }
    }

    static void Must(bool value, string name)
    {
        if (!value) throw new InvalidOperationException(name);
    }

    static void TestWatchdog()
    {
        var t = new WatchdogTracker();
        var now = DateTimeOffset.UtcNow;
        var view = new WorkerView("NV02", WorkerUiState.Working, "JOB_ACTIVE", "GH-1", null,
            true, false, true, null, "https://chatgpt.com/", 9222, now, true, true);
        Must(t.Observe(view, now).Health == HealthBand.Healthy, "watchdog healthy");
        Must(t.Observe(view, now.AddMinutes(3)).Health == HealthBand.Stalled, "watchdog stalled");
        Must(t.ShouldEscalate("NV02", now.AddMinutes(6)), "watchdog escalation");
        var idle = view with { State = WorkerUiState.Ready, Reason = "READY", JobId = null, UiBusy = false };
        Must(t.Observe(idle, now.AddMinutes(10)).Health == HealthBand.Healthy, "idle remains healthy");
        Must(!t.ShouldEscalate("NV02", now.AddMinutes(20)), "idle never escalates");
        t.BeginRecovery("NV02", now.AddMinutes(6));
        Must(t.Observe(view, now.AddMinutes(6)).Health == HealthBand.Recovering, "watchdog recovering");
    }

    static void TestSavePrompt()
    {
        var token = Guid.NewGuid().ToString();
        var prompt = SavePrompt.Build(token, "NV02", DateTimeOffset.UtcNow);
        Must(prompt.Contains("TIGERIQ_SAVE_STATUS=DURABLE"), "save durable gate");
        Must(prompt.Contains(token), "save token");
    }

    static void TestSettingsRoundTrip()
    {
        var settings = UtilitySettings.CreateDefault();
        settings.Workers["NV02"].Paused = true;
        settings.Workers["NV02"].BadgeOffsetX = 24;
        settings.Workers["NV02"].BadgeOffsetY = 42;
        settings.Workers["NV02"].PopupX = 111;
        settings.Workers["NV02"].PopupY = 222;
        settings.Schedules["NV02"] = new ScheduleSettings { IntervalMinutes = 10, NextCheckAt = DateTimeOffset.UtcNow.AddMinutes(10) };
        var text = System.Text.Json.JsonSerializer.Serialize(settings);
        var copy = System.Text.Json.JsonSerializer.Deserialize<UtilitySettings>(text)!;
        Must(copy.Workers["NV02"].Paused, "settings paused persistence");
        Must(copy.Workers["NV02"].BadgeOffsetX == 24 && copy.Workers["NV02"].BadgeOffsetY == 42, "badge persistence");
        Must(copy.Workers["NV02"].PopupX == 111 && copy.Workers["NV02"].PopupY == 222, "popup persistence");
        Must(copy.Schedules["NV02"].IntervalMinutes == 10, "schedule persistence");
    }

    static void TestUiPlacement()
    {
        var working = new Rectangle(0, 0, 1920, 1080);
        var chrome = new Rectangle(0, 0, 1500, 1040);
        var badgeSize = new Size(52, 26);
        var badge = UiPlacement.DefaultBadge(chrome, badgeSize, working);
        Must(badge.X >= working.Left && badge.Y >= working.Top, "badge inside working area");
        Must(badge.X + badgeSize.Width <= working.Right && badge.Y + badgeSize.Height <= working.Bottom, "badge fully visible");

        var clamped = UiPlacement.Clamp(new Point(4000, 4000), new Size(320, 620), working);
        Must(clamped.X == 1600 && clamped.Y == 460, "popup clamp");

        var popupSize = new Size(336, 690);
        var ok = UiPlacement.TryPopup(chrome, popupSize, new[] { working }, new[] { chrome }, null, out var target);
        Must(ok, "popup finds safe sidecar space");
        Must(!new Rectangle(target, popupSize).IntersectsWith(chrome), "popup never overlaps chrome");

        var savedInsideChrome = new Point(100, 100);
        ok = UiPlacement.TryPopup(chrome, popupSize, new[] { working }, new[] { chrome }, savedInsideChrome, out target);
        Must(ok, "unsafe saved popup position is ignored");
        Must(!new Rectangle(target, popupSize).IntersectsWith(chrome), "saved popup cannot force overlap");

        var fullScreenChrome = new Rectangle(0, 0, 1920, 1080);
        ok = UiPlacement.TryPopup(fullScreenChrome, popupSize, new[] { working }, new[] { fullScreenChrome }, null, out _);
        Must(!ok, "popup fails closed when no safe sidecar space exists");
    }
}
