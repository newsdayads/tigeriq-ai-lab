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
            badges[worker.Id] = new BadgeForm(worker, ShowPopup, SaveBadgeOffset, ResetBadgePosition);
        }

        trayPanel = new TrayPanelForm(ShowPopup, ShowAllPopups, ToggleDnd, ExitUtility);
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
        store.Log("SYSTEM", "UTILITY_STARTED", new { version = Application.ProductVersion, issue = 817 });
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
            item.Click += (_, _) => ShowPopup(id);
            trayWorkerItems[id] = item;
            menu.Items.Add(item);
        }
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("▦  Mở tất cả bảng điều khiển", null, (_, _) => ShowAllPopups());
        menu.Items.Add("◐  Bật / tắt Không làm phiền", null, (_, _) => ToggleDnd());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("⏻  Thoát TigerIQ Workers", null, (_, _) => ExitUtility());
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

    void ShowPopup(string id)
    {
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
            if (notifyOnFailure) MessageBox.Show($"{id}: không xác định được đúng cửa sổ Chrome. Fail-closed.", "TigerIQ");
            return false;
        }

        settings.Schedules.TryGetValue(id, out var sched);
        health.TryGetValue(id, out var wd);
        var occupied = new List<Rectangle>();
        foreach (var worker in Workers.All)
            if (binder.TryResolve(worker.Id, out _, out var chromeRect) && chromeRect.Width > 0 && chromeRect.Height > 0)
                occupied.Add(chromeRect);
        foreach (var pair in popups)
            if (pair.Key != id && pair.Value.Visible)
                occupied.Add(pair.Value.Bounds);

        var ok = popups[id].ShowWorker(
            Workers.Get(id), view, wd, settings.Workers[id], sched, settings.DoNotDisturb,
            store.RecentLogs(id), rect, occupied.ToArray());
        if (!ok && notifyOnFailure)
        {
            MessageBox.Show(
                "Không có vùng trống an toàn để mở bảng điều khiển mà không che Chrome hoặc bảng điều khiển khác. Hãy đóng một bảng đang mở hoặc chuyển cửa sổ rồi thử lại.",
                "TigerIQ — Không chồng cửa sổ",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        return ok;
    }

    void ShowAllPopups()
    {
        var opened = 0;
        foreach (var worker in Workers.All)
            if (TryShowPopup(worker.Id, false)) opened++;
        store.Log("SYSTEM", "OPEN_ALL_POPUPS", new { opened, requested = Workers.All.Length });
        if (opened < Workers.All.Length)
        {
            tray.BalloonTipTitle = "TigerIQ Workers";
            tray.BalloonTipText = $"Đã mở {opened}/{Workers.All.Length} bảng. Bảng còn lại bị giữ lại để không che Chrome.";
            tray.ShowBalloonTip(4000);
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
            case "health": MessageBox.Show(await controller.QuickHealthAsync(id), $"Kiểm tra nhanh {id}"); break;
            case "save":
                var saved = await controller.SaveAsync(id, false);
                MessageBox.Show($"Đã lưu bền vững: {saved.CheckpointRef}", $"Lưu {id}");
                break;
            case "save-archive":
                var archived = await controller.SaveAsync(id, true);
                MessageBox.Show($"Đã lưu + lưu trữ: {archived.CheckpointRef}", $"Lưu & Lưu trữ {id}");
                break;
            case "close": await controller.SafeCloseAsync(id); break;
            case "recover": await SafeRecoverAsync(id); break;
            case "schedule-10": SetSchedule(id, 10); break;
            case "schedule-30": SetSchedule(id, 30); break;
            case "schedule-60": SetSchedule(id, 60); break;
            case "schedule-120": SetSchedule(id, 120); break;
            case "schedule-custom": SetSchedule(id, PromptMinutes()); break;
            case "schedule-cancel": settings.Schedules.Remove(id); break;
            case "schedule-on": EnsureSchedule(id, true); break;
            case "schedule-off": EnsureSchedule(id, false); break;
            case "schedule-change-only-on": EnsureSchedule(id, null).ChangesOnly = true; break;
            case "schedule-change-only-off": EnsureSchedule(id, null).ChangesOnly = false; break;
            case "dnd-on": settings.DoNotDisturb = true; break;
            case "dnd-off": settings.DoNotDisturb = false; break;
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

    int PromptMinutes()
    {
        using var form = new Form
        {
            Text = "Lịch tùy chỉnh",
            Width = 270,
            Height = 150,
            StartPosition = FormStartPosition.CenterScreen,
            AutoScaleMode = AutoScaleMode.Dpi,
            BackColor = Color.FromArgb(8, 19, 34),
            ForeColor = Color.White
        };
        var input = new NumericUpDown { Minimum = 1, Maximum = 1440, Value = 30, Left = 20, Top = 22, Width = 215 };
        var ok = new Button { Text = "Lưu", DialogResult = DialogResult.OK, Left = 90, Top = 62, Width = 80 };
        form.Controls.Add(input);
        form.Controls.Add(ok);
        form.AcceptButton = ok;
        return form.ShowDialog() == DialogResult.OK ? (int)input.Value : 30;
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
            using var font = new Font("Segoe UI", 9, FontStyle.Bold, GraphicsUnit.Pixel);
            TextRenderer.DrawText(g, "TQ", font, new Rectangle(0, 8, 32, 16), Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
        var handle = bitmap.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); }
        finally { DestroyIcon(handle); }
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);
}
