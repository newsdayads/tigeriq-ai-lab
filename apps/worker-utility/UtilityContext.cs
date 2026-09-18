using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace TigerIQ.WorkerUtility;

internal sealed class UtilityContext : ApplicationContext
{
    readonly StateStore store = new();
    readonly ControllerClient controller = new();
    readonly WindowBinder binder = new();
    readonly Dictionary<string, BadgeForm> badges = new();
    readonly Dictionary<string, PopupForm> popups = new();
    readonly Dictionary<string, WorkerView> views = new();
    readonly Dictionary<string, WatchdogView> health = new();
    readonly Dictionary<string, ToolStripMenuItem> trayWorkerItems = new();
    readonly WatchdogTracker watchdog = new();
    readonly NotifyIcon tray;
    readonly Icon trayIcon;
    readonly TrayPanelForm trayPanel;
    readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    UtilitySettings settings;
    bool ticking;
    int pollCounter;

    public UtilityContext()
    {
        settings = store.Load();
        foreach (var w in Workers.All)
            if (!settings.Workers.ContainsKey(w.Id)) settings.Workers[w.Id] = new WorkerSettings();
        store.EnsureAutostart();

        foreach (var worker in Workers.All)
        {
            popups[worker.Id] = new PopupForm(HandleActionAsync, SavePopupPosition);
            badges[worker.Id] = new BadgeForm(worker, TogglePopup, SaveBadgeOffset, ResetBadgePosition);
        }

        trayPanel = new TrayPanelForm(TogglePopup, () => _ = FocusAllChromeAsync(), OpenQuickPanel, ShowUtilitySettings, ShowSystemLogs, ExitUtility);
        trayIcon = CreateTrayIcon();
        tray = new NotifyIcon
        {
            Visible = true,
            Text = "TigerIQ Workers",
            Icon = trayIcon,
            ContextMenuStrip = BuildTrayMenu()
        };
        tray.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left)
            {
                trayPanel.ApplyStates(views, settings);
                trayPanel.ToggleNearTray();
            }
        };

        timer.Tick += async (_, _) => await TickAsync();
        timer.Start();
        store.Log("SYSTEM", "UTILITY_STARTED", new { version = Application.ProductVersion, issue = 820 });
    }

    ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip
        {
            Font = new Font("Segoe UI", 9),
            ShowImageMargin = false,
            BackColor = Color.FromArgb(8, 19, 34),
            ForeColor = Color.FromArgb(241, 245, 249)
        };
        var title = new ToolStripMenuItem("🐯  TigerIQ Workers") { Enabled = false };
        menu.Items.Add(title);
        menu.Items.Add(new ToolStripSeparator());
        foreach (var w in Workers.All)
        {
            var id = w.Id;
            var item = new ToolStripMenuItem($"{id} — {w.Name}");
            item.Click += (_, _) => TogglePopup(id);
            trayWorkerItems[id] = item;
            menu.Items.Add(item);
        }
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("▦  Mở tất cả cửa sổ", null, (_, _) => _ = FocusAllChromeAsync());
        menu.Items.Add("▣  Bảng điều khiển nhanh", null, (_, _) => OpenQuickPanel());
        menu.Items.Add("⚙  Cài đặt", null, (_, _) => ShowUtilitySettings());
        menu.Items.Add("▤  Xem log hệ thống", null, (_, _) => ShowSystemLogs());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("⏻  Thoát", null, (_, _) => ExitUtility());
        return menu;
    }

    async Task TickAsync()
    {
        if (ticking) return;
        ticking = true;
        try
        {
            foreach (var w in Workers.All)
            {
                if (binder.TryResolve(w.Id, out _, out var rect)) badges[w.Id].AnchorTo(rect, settings.Workers[w.Id]);
                else badges[w.Id].MarkUnbound();
            }
            if (++pollCounter % 2 == 0) await RefreshStateAsync();
            await RunSchedulesAsync();
            if (pollCounter % 5 == 0) await RunWatchdogAsync();
            if (!settings.DoNotDisturb && pollCounter % 5 == 0) await EnforceLocksAsync();
        }
        finally { ticking = false; }
    }

    async Task RefreshStateAsync()
    {
        foreach (var w in Workers.All)
        {
            WorkerView view;
            try { view = await controller.GetWorkerAsync(w.Id); }
            catch (Exception ex)
            {
                view = new WorkerView(w.Id, WorkerUiState.Blocked, "CONTROLLER_UNAVAILABLE", null, null,
                    false, false, false, ex.GetType().Name, null, w.DebugPort, null, false, false);
            }
            if (settings.Workers[w.Id].Paused)
                view = view with { State = WorkerUiState.Paused, Reason = "UTILITY_PAUSED" };
            TrackStateChange(w.Id, view);
            views[w.Id] = view;
            health[w.Id] = watchdog.Observe(view, DateTimeOffset.Now);
            badges[w.Id].ApplyState(view);
        }
        UpdateTraySurface();
    }

    void UpdateTraySurface()
    {
        trayPanel.ApplyStates(views, settings);
        foreach (var worker in Workers.All)
        {
            if (!trayWorkerItems.TryGetValue(worker.Id, out var item)) continue;
            if (!views.TryGetValue(worker.Id, out var view))
            {
                item.Text = $"●  {worker.Id} — {worker.Name} — chưa có dữ liệu";
                item.ForeColor = Color.FromArgb(248, 113, 113);
                continue;
            }
            item.Text = $"●  {worker.Id} — {worker.Name} — {StateDisplay(view)}";
            item.ForeColor = view.State switch
            {
                WorkerUiState.Ready or WorkerUiState.Working => Color.FromArgb(52, 211, 153),
                WorkerUiState.Paused => Color.FromArgb(251, 191, 36),
                _ => Color.FromArgb(248, 113, 113)
            };
        }
        var parts = Workers.All.Select(w =>
        {
            if (!views.TryGetValue(w.Id, out var v)) return $"{w.Id[2..]}:?";
            return $"{w.Id[2..]}:{(v.State == WorkerUiState.Working ? "RUN" : v.State == WorkerUiState.Ready ? "OK" : v.State == WorkerUiState.Paused ? "PAUSE" : "BLOCK")}";
        });
        var text = "TigerIQ Workers | " + string.Join(" ", parts);
        tray.Text = text.Length <= 63 ? text : "TigerIQ Workers";
    }

    static string StateDisplay(WorkerView view) => view.State switch
    {
        WorkerUiState.Ready => "Sẵn sàng",
        WorkerUiState.Working => $"Đang chạy {view.JobId ?? ""}".Trim(),
        WorkerUiState.Paused => "Tạm dừng",
        _ => $"Bị chặn: {view.Reason}"
    };

    void TrackStateChange(string id, WorkerView view)
    {
        var state = settings.Workers[id];
        var current = $"{view.State}:{view.Reason}:{view.JobId}";
        if (state.LastState == current) return;
        state.LastState = current;
        state.StateChangedAt = DateTimeOffset.Now;
        store.Save(settings);
        store.Log(id, "STATE_CHANGED", new { state = view.State.ToString(), view.Reason, view.JobId });
    }

    void SaveBadgeOffset(string id, Point offset)
    {
        var state = settings.Workers[id];
        state.BadgeOffsetX = offset.X;
        state.BadgeOffsetY = offset.Y;
        store.Save(settings);
        store.Log(id, "BADGE_POSITION_SAVED", new { offset.X, offset.Y });
    }

    void ResetBadgePosition(string id)
    {
        var state = settings.Workers[id];
        state.BadgeOffsetX = null;
        state.BadgeOffsetY = null;
        store.Save(settings);
        if (binder.TryResolve(id, out _, out var rect)) badges[id].AnchorTo(rect, state);
        store.Log(id, "BADGE_POSITION_RESET");
    }

    void SavePopupPosition(string id, Point location)
    {
        var state = settings.Workers[id];
        state.PopupX = location.X;
        state.PopupY = location.Y;
        store.Save(settings);
        store.Log(id, "POPUP_POSITION_SAVED", new { location.X, location.Y });
    }

    void TogglePopup(string id)
    {
        if (popups[id].Visible)
        {
            popups[id].Hide();
            store.Log(id, "POPUP_HIDDEN_BY_TOGGLE");
            return;
        }

        foreach (var pair in popups)
            if (pair.Key != id && pair.Value.Visible) pair.Value.Hide();

        if (!TryShowPopup(id, true)) return;
        store.Log(id, "POPUP_OPENED");
    }

    bool TryShowPopup(string id, bool notifyOnFailure)
    {
        if (!views.TryGetValue(id, out var view))
            view = new WorkerView(id, WorkerUiState.Blocked, "STATE_LOADING", null, null,
                false, false, false, null, null, Workers.Get(id).DebugPort, null, false, false);
        if (!binder.TryResolve(id, out _, out var rect))
        {
            if (notifyOnFailure) ShowTrayNotice($"TigerIQ {id}", "Không xác định được đúng cửa sổ Chrome.");
            return false;
        }

        settings.Schedules.TryGetValue(id, out var sched);
        health.TryGetValue(id, out var wd);
        var occupied = new List<Rectangle>();

        // The selected popup is allowed to overlay its OWN Chrome, exactly as the approved layout.
        // Other worker Chrome windows remain protected from overlap.
        foreach (var worker in Workers.All)
        {
            if (worker.Id == id) continue;
            if (binder.TryResolve(worker.Id, out _, out var chromeRect) && chromeRect.Width > 0 && chromeRect.Height > 0)
                occupied.Add(chromeRect);
        }

        foreach (var pair in popups)
            if (pair.Key != id && pair.Value.Visible)
                occupied.Add(pair.Value.Bounds);

        var ok = popups[id].ShowWorker(
            Workers.Get(id), view, wd, settings.Workers[id], sched, settings.DoNotDisturb,
            store.RecentLogs(id), rect, occupied.ToArray());
        if (!ok && notifyOnFailure)
            ShowTrayNotice("TigerIQ — Không chồng NV khác", "Không tìm được vị trí popup an toàn cho NV đã chọn.");
        return ok;
    }

    async Task FocusAllChromeAsync()
    {
        foreach (var worker in Workers.All)
        {
            try
            {
                await controller.FixPositionAsync(worker.Id);
                await controller.FocusAsync(worker.Id);
            }
            catch (Exception ex)
            {
                store.Log(worker.Id, "OPEN_ALL_WINDOWS_ERROR", new { error = ex.Message });
            }
        }
        store.Log("SYSTEM", "OPEN_ALL_CHROME_WINDOWS", new { count = Workers.All.Length });
    }

    void OpenQuickPanel()
    {
        var target = Workers.All
            .FirstOrDefault(w => views.TryGetValue(w.Id, out var v) && v.State == WorkerUiState.Working)
            ?? Workers.All[0];
        TogglePopup(target.Id);
    }

    void ShowSystemLogs()
    {
        using var form = new Form
        {
            Text = "TigerIQ — Log hệ thống",
            Width = 720,
            Height = 520,
            StartPosition = FormStartPosition.CenterScreen,
            BackColor = Color.FromArgb(5, 13, 25),
            ForeColor = Color.White
        };
        var box = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(5, 13, 25),
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Consolas", 9),
            Text = string.Join(Environment.NewLine, store.RecentLogs(120))
        };
        form.Controls.Add(box);
        form.ShowDialog();
    }

    void ShowUtilitySettings()
    {
        using var form = new Form
        {
            Text = "TigerIQ — Cài đặt",
            Width = 380,
            Height = 220,
            StartPosition = FormStartPosition.CenterScreen,
            BackColor = Color.FromArgb(5, 13, 25),
            ForeColor = Color.White
        };
        var dndBox = new CheckBox
        {
            Text = "Không làm phiền",
            Left = 24,
            Top = 28,
            Width = 220,
            Checked = settings.DoNotDisturb,
            ForeColor = Color.White,
            BackColor = form.BackColor
        };
        var info = new Label
        {
            Text = "Layout 2 đã khóa: 3 Chrome riêng · 1 popup/NV · badge luôn hiển thị.",
            Left = 24,
            Top = 64,
            Width = 315,
            Height = 42,
            ForeColor = Color.FromArgb(148, 163, 184)
        };
        var save = new Button { Text = "Lưu", Left = 248, Top = 124, Width = 90, DialogResult = DialogResult.OK };
        form.Controls.Add(dndBox);
        form.Controls.Add(info);
        form.Controls.Add(save);
        form.AcceptButton = save;
        if (form.ShowDialog() == DialogResult.OK)
        {
            settings.DoNotDisturb = dndBox.Checked;
            store.Save(settings);
            UpdateTraySurface();
        }
    }

    async Task HandleActionAsync(string id, string actionName)
    {
        store.Log(id, "ACTION_REQUEST", new { action = actionName });
        switch (actionName)
        {
            case "run":
                settings.Workers[id].Paused = false;
                await controller.ResumeAsync(id);
                break;
            case "pause":
                settings.Workers[id].Paused = true;
                await controller.PauseAsync(id);
                break;
            case "focus": await controller.FocusAsync(id); break;
            case "fix": await controller.FixPositionAsync(id); break;
            case "lock": settings.Workers[id].PositionLocked = !settings.Workers[id].PositionLocked; break;
            case "badge-reset": ResetBadgePosition(id); break;
            case "open": await controller.OpenCanonicalAsync(id); break;
            case "health":
                popups[id].SetActionNotice("✓ " + await controller.QuickHealthAsync(id), false);
                break;
            case "save":
                var saved = await controller.SaveAsync(id, false);
                popups[id].SetActionNotice($"✓ Đã lưu: {saved.CheckpointRef}", false);
                break;
            case "save-archive":
                var archived = await controller.SaveAsync(id, true);
                popups[id].SetActionNotice($"✓ Đã lưu & lưu trữ: {archived.CheckpointRef}", false);
                break;
            case "close":
                await controller.SafeCloseAsync(id);
                popups[id].SetActionNotice("✓ Chrome đã đóng an toàn", false);
                break;
            case "recover":
                await SafeRecoverAsync(id);
                popups[id].SetActionNotice("✓ Đã khôi phục an toàn", false);
                break;
            case "schedule-10": SetSchedule(id, 10); break;
            case "schedule-30": SetSchedule(id, 30); break;
            case "schedule-60": SetSchedule(id, 60); break;
            case "schedule-120": SetSchedule(id, 120); break;
            case "schedule-custom":
                var custom = PromptSchedule(id);
                if (custom is { } choice)
                {
                    SetSchedule(id, choice.Minutes);
                    settings.Schedules[id].ChangesOnly = choice.ChangesOnly;
                }
                break;
            case "schedule-cancel": settings.Schedules.Remove(id); break;
            case "schedule-on": EnsureSchedule(id, true); break;
            case "schedule-off": EnsureSchedule(id, false); break;
            case "schedule-change-only-on": EnsureSchedule(id, null).ChangesOnly = true; break;
            case "schedule-change-only-off": EnsureSchedule(id, null).ChangesOnly = false; break;
            case "dnd-on": settings.DoNotDisturb = true; break;
            case "dnd-off": settings.DoNotDisturb = false; break;
            case "screenshot": CaptureWorkerScreenshot(id); break;
            case "safe-retry": await SafeRetryAsync(id); break;
            case "advanced": break; // compatibility alias; UI now toggles advanced details locally
            default: throw new InvalidOperationException("UNKNOWN_UTILITY_ACTION:" + actionName);
        }
        store.Save(settings);
        store.Log(id, "ACTION_OK", new { action = actionName });
        await RefreshStateAsync();
        TryShowPopup(id, false);
    }

    ScheduleSettings EnsureSchedule(string id, bool? enabled)
    {
        if (!settings.Schedules.TryGetValue(id, out var sched))
        {
            sched = new ScheduleSettings
            {
                IntervalMinutes = 30,
                NextCheckAt = DateTimeOffset.Now.AddMinutes(30),
                LastFingerprint = views.TryGetValue(id, out var view) ? Fingerprint(view) : "",
                Enabled = enabled ?? true,
                ChangesOnly = true
            };
            settings.Schedules[id] = sched;
        }
        if (enabled is bool on)
        {
            sched.Enabled = on;
            if (on && (sched.NextCheckAt is null || sched.NextCheckAt <= DateTimeOffset.Now))
                sched.NextCheckAt = DateTimeOffset.Now.AddMinutes(Math.Max(1, sched.IntervalMinutes));
        }
        return sched;
    }

    void SetSchedule(string id, int minutes)
    {
        if (minutes < 1 || minutes > 24 * 60) throw new InvalidOperationException("SCHEDULE_INTERVAL_INVALID");
        var changesOnly = settings.Schedules.TryGetValue(id, out var existing) ? existing.ChangesOnly : true;
        settings.Schedules[id] = new ScheduleSettings
        {
            IntervalMinutes = minutes,
            NextCheckAt = DateTimeOffset.Now.AddMinutes(minutes),
            LastFingerprint = views.TryGetValue(id, out var v) ? Fingerprint(v) : "",
            Enabled = true,
            ChangesOnly = changesOnly
        };
    }

    async Task RunSchedulesAsync()
    {
        foreach (var item in settings.Schedules.ToArray())
        {
            var sched = item.Value;
            if (!sched.Enabled || sched.NextCheckAt is null || sched.NextCheckAt > DateTimeOffset.Now) continue;
            WorkerView v;
            try { v = await controller.GetWorkerAsync(item.Key); }
            catch (Exception ex)
            {
                NotifyChanged(item.Key, "Lỗi kiểm tra: " + ex.Message);
                sched.NextCheckAt = DateTimeOffset.Now.AddMinutes(sched.IntervalMinutes);
                store.Save(settings);
                continue;
            }
            var fp = Fingerprint(v);
            var changed = !string.Equals(fp, sched.LastFingerprint, StringComparison.Ordinal);
            if (!sched.ChangesOnly || changed || v.State == WorkerUiState.Blocked)
                NotifyChanged(item.Key, $"{StateDisplay(v)}");
            sched.LastFingerprint = fp;
            sched.NextCheckAt = DateTimeOffset.Now.AddMinutes(sched.IntervalMinutes);
            store.Save(settings);
        }
    }

    static string Fingerprint(WorkerView v)
        => $"{v.State}|{v.Reason}|{v.JobId}|{v.UiReady}|{v.AuthRequired}|{v.SecurityBlock}|{v.WindowOpen}";

    void NotifyChanged(string id, string message)
    {
        store.Log(id, "SCHEDULE_CHANGE", new { message });
        if (settings.DoNotDisturb) return;
        tray.BalloonTipTitle = $"TigerIQ {id}";
        tray.BalloonTipText = message;
        tray.ShowBalloonTip(5000);
    }

    async Task EnforceLocksAsync()
    {
        foreach (var w in Workers.All)
        {
            if (!settings.Workers[w.Id].PositionLocked) continue;
            if (settings.Workers[w.Id].Paused) continue;
            try { await controller.FixPositionAsync(w.Id); }
            catch (Exception ex) { store.Log(w.Id, "POSITION_LOCK_ERROR", new { error = ex.Message }); }
        }
    }

    void ToggleDnd()
    {
        settings.DoNotDisturb = !settings.DoNotDisturb;
        store.Save(settings);
        store.Log("SYSTEM", "DND_CHANGED", new { settings.DoNotDisturb });
        UpdateTraySurface();
    }

    void ShowTrayNotice(string title, string message)
    {
        store.Log("SYSTEM", "UI_NOTICE", new { title, message });
        if (settings.DoNotDisturb) return;
        tray.BalloonTipTitle = title;
        tray.BalloonTipText = message;
        tray.ShowBalloonTip(3500);
    }

    async Task RunWatchdogAsync()
    {
        foreach (var w in Workers.All)
        {
            if (!views.TryGetValue(w.Id, out var v) || !health.TryGetValue(w.Id, out var h)) continue;
            if (h.Health == HealthBand.Blocked)
            {
                if (!settings.DoNotDisturb) NotifyChanged(w.Id, $"Bị chặn: {v.Reason}");
                continue;
            }
            if (!watchdog.ShouldEscalate(w.Id, DateTimeOffset.Now)) continue;
            watchdog.BeginRecovery(w.Id, DateTimeOffset.Now);
            store.Log(w.Id, "WATCHDOG_ESCALATE", new { health = h.Health.ToString(), h.NoProgressFor, v.JobId, v.Reason });
            try
            {
                var healthText = await controller.QuickHealthAsync(w.Id);
                store.Log(w.Id, "WATCHDOG_RECHECK", new { healthText });
                if (v.AuthRequired || !string.IsNullOrWhiteSpace(v.SecurityBlock)) throw new InvalidOperationException("WATCHDOG_SECURITY_BLOCK");
                await controller.FocusAsync(w.Id);
                await Task.Delay(500);
                var next = await controller.GetWorkerAsync(w.Id);
                var progressed = next.Reason != v.Reason || next.UiBusy != v.UiBusy || next.JobId != v.JobId;
                watchdog.EndRecovery(w.Id, progressed, DateTimeOffset.Now);
                if (!progressed)
                {
                    store.Log(w.Id, "WATCHDOG_FAIL_CLOSED", new { reason = "NO_SAFE_IDEMPOTENT_REDISPATCH_PROOF" });
                    NotifyChanged(w.Id, "Treo — cần khôi phục an toàn");
                }
            }
            catch (Exception ex)
            {
                watchdog.EndRecovery(w.Id, false, DateTimeOffset.Now);
                store.Log(w.Id, "WATCHDOG_BLOCKED", new { error = ex.Message });
                NotifyChanged(w.Id, "Bị chặn: " + ex.Message);
            }
        }
    }

    async Task SafeRecoverAsync(string id)
    {
        var now = DateTimeOffset.Now;
        if (views.TryGetValue(id, out var current))
        {
            if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
                throw new InvalidOperationException($"RECOVERY_FAIL_CLOSED:{current.Reason}");
            if (current.UiBusy || !string.IsNullOrWhiteSpace(current.JobId))
                throw new InvalidOperationException("RECOVERY_ACTIVE_JOB_FORBIDDEN");
        }
        watchdog.BeginRecovery(id, now);
        store.Log(id, "RECOVERY_BEGIN");
        try
        {
            await controller.SafeRecoverAsync(id);
            await Task.Delay(1200);
            var next = await controller.GetWorkerAsync(id);
            var progressed = next.State is WorkerUiState.Ready or WorkerUiState.Working;
            watchdog.EndRecovery(id, progressed, DateTimeOffset.Now);
            store.Log(id, "RECOVERY_END", new { progressed, next.Reason });
            if (!progressed) throw new InvalidOperationException("SAFE_RECOVER_NOT_READY");
        }
        catch
        {
            watchdog.EndRecovery(id, false, DateTimeOffset.Now);
            throw;
        }
    }

    sealed record ScheduleChoice(int Minutes, bool ChangesOnly);

    ScheduleChoice? PromptSchedule(string id)
    {
        using var form = new Form
        {
            Text = $"Đặt lịch kiểm tra — {id}",
            Width = 430,
            Height = 360,
            StartPosition = FormStartPosition.CenterScreen,
            AutoScaleMode = AutoScaleMode.Dpi,
            BackColor = Color.FromArgb(8, 19, 34),
            ForeColor = Color.White,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false
        };

        var title = new Label { Text = "Đặt lịch kiểm tra", Left = 20, Top = 16, Width = 250, Font = new Font("Segoe UI", 12, FontStyle.Bold) };
        form.Controls.Add(title);

        var choices = new (string Text, int Minutes)[] { ("10 phút",10),("30 phút",30),("1 giờ",60),("2 giờ",120) };
        var radios = new List<RadioButton>();
        var y = 54;
        foreach (var item in choices)
        {
            var rb = new RadioButton { Text = item.Text, Left = 24, Top = y, Width = 120, Tag = item.Minutes, ForeColor = Color.White, BackColor = form.BackColor };
            radios.Add(rb); form.Controls.Add(rb); y += 30;
        }

        var customRadio = new RadioButton { Text = "Tùy chỉnh", Left = 24, Top = y, Width = 120, ForeColor = Color.White, BackColor = form.BackColor };
        var custom = new NumericUpDown { Left = 150, Top = y - 2, Width = 90, Minimum = 1, Maximum = 1440, Value = 30 };
        var minutesText = new Label { Text = "phút", Left = 248, Top = y + 2, Width = 60, ForeColor = Color.White };
        form.Controls.Add(customRadio); form.Controls.Add(custom); form.Controls.Add(minutesText);
        y += 42;

        var changes = new CheckBox { Text = "Chỉ báo khi có thay đổi / lỗi", Left = 24, Top = y, Width = 260, ForeColor = Color.White, BackColor = form.BackColor, Checked = settings.Schedules.TryGetValue(id, out var old) ? old.ChangesOnly : true };
        form.Controls.Add(changes);
        y += 34;

        var next = new Label { Left = 24, Top = y, Width = 350, Height = 28, ForeColor = Color.FromArgb(251,191,36) };
        form.Controls.Add(next);

        void RefreshNext()
        {
            var mins = customRadio.Checked ? (int)custom.Value : radios.FirstOrDefault(r => r.Checked)?.Tag is int n ? n : 30;
            next.Text = $"Lần kiểm tra kế tiếp: {DateTime.Now.AddMinutes(mins):HH:mm}";
        }
        foreach (var rb in radios) rb.CheckedChanged += (_, _) => RefreshNext();
        customRadio.CheckedChanged += (_, _) => RefreshNext();
        custom.ValueChanged += (_, _) => RefreshNext();

        var currentMinutes = settings.Schedules.TryGetValue(id, out var sched) ? sched.IntervalMinutes : 30;
        var matched = radios.FirstOrDefault(r => (int)r.Tag! == currentMinutes);
        if (matched is not null) matched.Checked = true;
        else { customRadio.Checked = true; custom.Value = Math.Clamp(currentMinutes, 1, 1440); }
        RefreshNext();

        var cancel = new Button { Text = "Hủy", Left = 200, Top = 278, Width = 90, DialogResult = DialogResult.Cancel };
        var save = new Button { Text = "Lưu", Left = 300, Top = 278, Width = 90, DialogResult = DialogResult.OK };
        form.Controls.Add(cancel); form.Controls.Add(save);
        form.CancelButton = cancel; form.AcceptButton = save;

        if (form.ShowDialog() != DialogResult.OK) return null;
        var minutes = customRadio.Checked ? (int)custom.Value : radios.First(r => r.Checked).Tag is int v ? v : 30;
        return new ScheduleChoice(minutes, changes.Checked);
    }

    void CaptureWorkerScreenshot(string id)
    {
        if (!binder.TryResolve(id, out _, out var rect) || rect.Width <= 0 || rect.Height <= 0)
            throw new InvalidOperationException("SCREENSHOT_WINDOW_NOT_FOUND");
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TigerIQ", "WorkerUtility", "Screenshots");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"{id}-{DateTime.Now:yyyyMMdd-HHmmss}.png");
        using var bitmap = new Bitmap(rect.Width, rect.Height);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CopyFromScreen(rect.Location, Point.Empty, rect.Size);
        bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        popups[id].SetActionNotice("✓ Đã chụp: " + path, false);
        store.Log(id, "SCREENSHOT_SAVED", new { path });
    }

    async Task SafeRetryAsync(string id)
    {
        var current = await controller.GetWorkerAsync(id);
        if (current.AuthRequired || !string.IsNullOrWhiteSpace(current.SecurityBlock))
            throw new InvalidOperationException($"SAFE_RETRY_BLOCKED:{current.Reason}");
        if (current.UiBusy || !string.IsNullOrWhiteSpace(current.JobId))
            throw new InvalidOperationException("SAFE_RETRY_ACTIVE_JOB_FORBIDDEN");
        await controller.FocusAsync(id);
        await controller.FixPositionAsync(id);
        popups[id].SetActionNotice("✓ Đã kiểm tra và focus lại an toàn", false);
        store.Log(id, "SAFE_RETRY_OK");
    }

    void ExitUtility()
    {
        timer.Stop();
        foreach (var b in badges.Values) b.Close();
        foreach (var p in popups.Values) p.Close();
        trayPanel.Close();
        tray.Visible = false;
        tray.Dispose();
        trayIcon.Dispose();
        ExitThread();
    }

    static Icon CreateTrayIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var outer = new SolidBrush(Color.FromArgb(8, 19, 34));
            using var accent = new Pen(Color.FromArgb(245, 158, 11), 3);
            g.FillEllipse(outer, 1, 1, 30, 30);
            g.DrawEllipse(accent, 3, 3, 26, 26);
            using var font = new Font("Segoe UI Emoji", 17, FontStyle.Regular, GraphicsUnit.Pixel);
            TextRenderer.DrawText(g, "🐯", font, new Rectangle(0, 4, 32, 24), Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
        var handle = bitmap.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); }
        finally { DestroyIcon(handle); }
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);
}
