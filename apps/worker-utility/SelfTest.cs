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

        // Critical-edge search must find an interior pocket that is not any screen corner.
        var pocketWorking = new Rectangle(0, 0, 1000, 800);
        var pocketPopup = new Size(200, 200);
        var pocketBlockers = new[] {
            new Rectangle(0, 0, 300, 800),
            new Rectangle(700, 0, 300, 800),
            new Rectangle(300, 0, 400, 250),
            new Rectangle(300, 550, 400, 250)
        };
        ok = UiPlacement.TryPopup(new Rectangle(0, 0, 300, 800), pocketPopup, new[] { pocketWorking }, pocketBlockers, null, out target);
        Must(ok, "geometry-complete search finds interior pocket");
        Must(pocketBlockers.All(b => !Rectangle.Inflate(b, 10, 10).IntersectsWith(new Rectangle(target, pocketPopup))), "interior pocket respects safety gaps");

        // Multi-monitor: if the anchor monitor is fully occupied, use a genuinely free secondary monitor.
        var primary = new Rectangle(0, 0, 1920, 1080);
        var secondary = new Rectangle(1920, 0, 1600, 900);
        var fullPrimaryChrome = new Rectangle(0, 0, 1920, 1080);
        ok = UiPlacement.TryPopup(fullPrimaryChrome, popupSize, new[] { primary, secondary }, new[] { fullPrimaryChrome }, null, out target);
        Must(ok, "popup uses free secondary monitor");
        Must(secondary.Contains(new Rectangle(target, popupSize)), "popup fully contained on secondary monitor");

        // Exact safe saved coordinates must be preserved; unsafe saved coordinates must never be clamped across monitors.
        var safeSaved = new Point(2100, 100);
        ok = UiPlacement.TryPopup(fullPrimaryChrome, popupSize, new[] { primary, secondary }, new[] { fullPrimaryChrome }, safeSaved, out target);
        Must(ok && target == safeSaved, "safe saved secondary position preserved exactly");
        var unsafeSaved = new Point(100, 100);
        ok = UiPlacement.TryPopup(fullPrimaryChrome, popupSize, new[] { primary, secondary }, new[] { fullPrimaryChrome }, unsafeSaved, out target);
        Must(ok && target != unsafeSaved && secondary.Contains(new Rectangle(target, popupSize)), "unsafe saved position rejected and safely relocated");

        var fullScreenChrome = new Rectangle(0, 0, 1920, 1080);
        ok = UiPlacement.TryPopup(fullScreenChrome, popupSize, new[] { working }, new[] { fullScreenChrome }, null, out _);
        Must(!ok, "popup fails closed when no safe sidecar space exists");

        // DpiUnaware process contract: Windows virtualizes both Screen/Chrome bounds to 96-DPI logical coordinates.
        // Simulate a 150% monitor, place in logical space, then map result back to physical pixels and re-check safety.
        const int dpi = 144;
        var physicalWorking = new Rectangle(0, 0, 2560, 1400);
        var physicalChrome = new Rectangle(1000, 0, 1560, 1400);
        var logicalWorking = ToLogical(physicalWorking, dpi);
        var logicalChrome = ToLogical(physicalChrome, dpi);
        ok = UiPlacement.TryPopup(logicalChrome, popupSize, new[] { logicalWorking }, new[] { logicalChrome }, null, out target);
        Must(ok, "150-percent DPI logical placement succeeds");
        var physicalPopup = ToPhysical(new Rectangle(target, popupSize), dpi);
        Must(physicalWorking.Contains(physicalPopup), "150-percent DPI popup remains inside physical working area");
        Must(!physicalPopup.IntersectsWith(physicalChrome), "150-percent DPI popup remains physically clear of Chrome");
    }

    static Rectangle ToLogical(Rectangle physical, int dpi)
    {
        int Scale(int value) => (int)Math.Round(value * 96.0 / dpi, MidpointRounding.AwayFromZero);
        return new Rectangle(Scale(physical.X), Scale(physical.Y), Scale(physical.Width), Scale(physical.Height));
    }

    static Rectangle ToPhysical(Rectangle logical, int dpi)
    {
        int Scale(int value) => (int)Math.Round(value * dpi / 96.0, MidpointRounding.AwayFromZero);
        return new Rectangle(Scale(logical.X), Scale(logical.Y), Scale(logical.Width), Scale(logical.Height));
    }
}
