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
            TestWorkerIdentityOrder();
            TestBrowserHarnessProbeParsing();
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
        settings.LayoutRevision = 2;
        settings.Workers["NV02"].Paused = true;
        settings.Workers["NV02"].BadgeOffsetX = 24;
        settings.Workers["NV02"].BadgeOffsetY = 42;
        settings.Workers["NV02"].PopupX = 111;
        settings.Workers["NV02"].PopupY = 222;
        settings.Schedules["NV02"] = new ScheduleSettings { IntervalMinutes = 10, NextCheckAt = DateTimeOffset.UtcNow.AddMinutes(10), Enabled = true, ChangesOnly = false };
        var text = System.Text.Json.JsonSerializer.Serialize(settings);
        var copy = System.Text.Json.JsonSerializer.Deserialize<UtilitySettings>(text)!;
        Must(copy.LayoutRevision == 2, "layout revision persistence");
        Must(copy.Workers["NV02"].Paused, "settings paused persistence");
        Must(copy.Workers["NV02"].BadgeOffsetX == 24 && copy.Workers["NV02"].BadgeOffsetY == 42, "badge persistence");
        Must(copy.Workers["NV02"].PopupX == 111 && copy.Workers["NV02"].PopupY == 222, "popup persistence");
        Must(copy.Schedules["NV02"].IntervalMinutes == 10, "schedule persistence");
        Must(copy.Schedules["NV02"].Enabled && !copy.Schedules["NV02"].ChangesOnly, "schedule display preference persistence");
    }

    static void TestWorkerIdentityOrder()
    {
        Must(Workers.All.Select(x => x.Id).SequenceEqual(new[] { "NV02", "NV03", "NV04" }), "worker display order");
        Must(Workers.Get("NV02").Name == "ChatGPT Plus", "NV02 identity");
        Must(Workers.Get("NV03").Name == "ChatGPT Go", "NV03 identity");
        Must(Workers.Get("NV04").Name == "Gemini Pro", "NV04 identity");
    }

    static void TestBrowserHarnessProbeParsing()
    {
        Must(BrowserHarnessClient.PilotEnabled("NV04"), "harness pilot NV04");
        Must(!BrowserHarnessClient.PilotEnabled("NV02"), "harness pilot excludes NV02");
        var parsed = BrowserHarnessClient.ParseProbeOutput("NV04",
            "update available\n{\"url\":\"https://gemini.google.com/app\",\"title\":\"Gemini\",\"w\":1000}\n");
        Must(parsed.State == HarnessState.Ready, "harness parses page_info json");
        Must(parsed.Url == "https://gemini.google.com/app", "harness preserves url");
        var bad = BrowserHarnessClient.ParseProbeOutput("NV04", "not-json");
        Must(bad.State == HarnessState.Error, "harness fails closed on malformed output");
        var token = "abc123";
        var mutation = BrowserHarnessClient.ParseMutationProbeOutput("NV04", $"noise\n{token}\n", token, "https://gemini.google.com/app");
        Must(mutation.State == HarnessState.Ready && mutation.Summary == "MUTATION_PROBE_OK", "harness mutation probe confirms exact token");
        var mismatch = BrowserHarnessClient.ParseMutationProbeOutput("NV04", "different", token, null);
        Must(mismatch.State == HarnessState.Error, "harness mutation probe fails closed on mismatch");
    }

    static void TestUiPlacement()
    {
        var working = new Rectangle(0, 0, 1920, 1080);
        var chrome = new Rectangle(0, 0, 1500, 1040);
        var badgeSize = new Size(48, 26);
        var badgeOk = UiPlacement.TryBadge(chrome, badgeSize, working, null, null, out var badge);
        Must(badgeOk, "badge has safe own-window title space");
        Must(badge.X >= working.Left && badge.Y >= working.Top, "badge inside working area");
        Must(badge.X + badgeSize.Width <= working.Right && badge.Y + badgeSize.Height <= working.Bottom, "badge fully visible");
        Must(chrome.Contains(new Rectangle(badge, badgeSize)), "badge stays inside its own Chrome window");
        Must(badge.X < chrome.Left + chrome.Width / 2, "badge stays on the left half of its own title strip");
        var tinyChrome = new Rectangle(0, 0, 40, 20);
        Must(!UiPlacement.TryBadge(tinyChrome, badgeSize, working, null, null, out _), "badge fails closed when own title strip is too small");
        Must(UiPlacement.TryBadge(chrome, badgeSize, working, 5000, 5000, out var draggedBadge)
            && chrome.Contains(new Rectangle(draggedBadge, badgeSize)), "saved badge offset clamps to its own title strip");

        var desktop = new Rectangle(0, 0, 3277, 1688);
        var dockSize = new Size(344, 728);
        var dock0 = UiPlacement.DockedPopup(0, 3, dockSize, desktop);
        var dock1 = UiPlacement.DockedPopup(1, 3, dockSize, desktop);
        var dock2 = UiPlacement.DockedPopup(2, 3, dockSize, desktop);
        Must(dock0.Y == dock1.Y && dock1.Y == dock2.Y, "worker panels share one bottom row");
        Must(dock0.X < dock1.X && dock1.X < dock2.X, "worker panels preserve NV02 NV03 NV04 order");
        Must(dock2.X + dockSize.Width <= desktop.Right - 8, "rightmost panel respects dock margin");
        Must(!new Rectangle(dock0, dockSize).IntersectsWith(new Rectangle(dock1, dockSize)), "dock slot 0 and 1 do not overlap");
        Must(!new Rectangle(dock1, dockSize).IntersectsWith(new Rectangle(dock2, dockSize)), "dock slot 1 and 2 do not overlap");
        var savedUser = new Point(777, 333);
        Must(UiPlacement.ResolvePopup(savedUser, dock0, dockSize, desktop) == savedUser, "user dragged popup stays where dropped");
        var offscreenUser = new Point(9999, 9999);
        var clampedUser = UiPlacement.ResolvePopup(offscreenUser, dock0, dockSize, desktop);
        Must(desktop.Contains(new Rectangle(clampedUser, dockSize)), "saved popup clamps only to visible desktop");

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

        // Frozen Layout 2: remembered popup coordinates are valid only inside the selected worker's own Chrome.
        // Old sidecar/secondary-monitor coordinates must be discarded instead of preserved.
        var staleSaved = new Point(2100, 100);
        ok = UiPlacement.TryPopup(fullPrimaryChrome, popupSize, new[] { primary, secondary }, new[] { fullPrimaryChrome }, staleSaved, out target);
        Must(ok && target != staleSaved && secondary.Contains(new Rectangle(target, popupSize)), "stale saved secondary position rejected and safely relocated");
        var unsafeSaved = new Point(100, 100);
        ok = UiPlacement.TryPopup(fullPrimaryChrome, popupSize, new[] { primary, secondary }, new[] { fullPrimaryChrome }, unsafeSaved, out target);
        Must(ok && target != unsafeSaved && secondary.Contains(new Rectangle(target, popupSize)), "blocked saved position rejected and safely relocated");

        // Selected-worker overlay: when its own Chrome is NOT a blocker, prefer the approved inset overlay.
        var ownChrome = new Rectangle(1000, 0, 500, 834);
        var ownPopup = new Size(312, 650);
        ok = UiPlacement.TryPopup(ownChrome, ownPopup, new[] { working }, Array.Empty<Rectangle>(), null, out target);
        Must(ok, "selected worker popup can overlay its own Chrome");
        Must(target == new Point(ownChrome.Left, ownChrome.Top + 64), "selected worker popup uses approved inset overlay");
        Must(ownChrome.Contains(new Rectangle(target, ownPopup)), "selected worker popup stays inside its own Chrome");

        var savedOverBadge = new Point(ownChrome.Left + 17, ownChrome.Top);
        ok = UiPlacement.TryPopup(ownChrome, ownPopup, new[] { working }, Array.Empty<Rectangle>(), savedOverBadge, out target);
        Must(ok && target == new Point(ownChrome.Left, ownChrome.Top + 64), "saved popup overlapping badge strip is rejected");

        var neighborChrome = new Rectangle(500, 0, 515, 834);
        var selectedChrome = new Rectangle(1008, 0, 515, 834);
        ok = UiPlacement.TryPopup(selectedChrome, new Size(312, 650), new[] { new Rectangle(0, 0, 3277, 1688) },
            new[] { neighborChrome }, null, out target);
        Must(ok && target.Y >= selectedChrome.Top + 64, "fallback popup candidate never covers selected badge strip");

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
