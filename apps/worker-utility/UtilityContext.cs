namespace TigerIQ.WorkerUtility;

internal sealed class UtilityContext : ApplicationContext
{
    readonly StateStore store = new();
    readonly ControllerClient controller = new();
    readonly WindowBinder binder = new();
    readonly Dictionary<string, BadgeForm> badges = new();
    readonly Dictionary<string, WorkerView> views = new();
    readonly Dictionary<string, WatchdogView> health = new();
    readonly WatchdogTracker watchdog = new();
    readonly PopupForm popup;
    readonly NotifyIcon tray;
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
        popup = new PopupForm(HandleActionAsync, SavePopupPosition);
        foreach (var worker in Workers.All)
        {
            var badge = new BadgeForm(worker, ShowPopup, SaveBadgeOffset, ResetBadgePosition);
            badges[worker.Id] = badge;
        }
        tray = new NotifyIcon
        {
            Visible = true,
            Text = "TigerIQ Worker Utility",
            Icon = SystemIcons.Application,
            ContextMenuStrip = BuildTrayMenu()
        };
        timer.Tick += async (_, _) => await TickAsync();
        timer.Start();
        store.Log("SYSTEM", "UTILITY_STARTED", new { version = Application.ProductVersion });
    }

    ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        foreach (var w in Workers.All)
        {
            var id = w.Id;
            menu.Items.Add($"Mở {id}", null, (_, _) => ShowPopup(id));
        }
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Không làm phiền", null, (_, _) => ToggleDnd());
        menu.Items.Add("Thoát Utility", null, (_, _) => ExitUtility());
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
    }

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
        if (!views.TryGetValue(id, out var view))
            view = new WorkerView(id, WorkerUiState.Blocked, "STATE_LOADING", null, null,
                false, false, false, null, null, Workers.Get(id).DebugPort, null, false, false);
        if (!binder.TryResolve(id, out _, out var rect))
        {
            MessageBox.Show($"{id}: không xác định được đúng cửa sổ Chrome. Fail-closed.", "TigerIQ");
            return;
        }
        settings.Schedules.TryGetValue(id, out var sched);
        health.TryGetValue(id, out var wd);
        popup.ShowWorker(Workers.Get(id), view, wd, settings.Workers[id], sched, settings.DoNotDisturb, store.RecentLogs(), rect);
    }

    async Task HandleActionAsync(string id, string action)
    {
        store.Log(id, "ACTION_REQUEST", new { action });
        switch (action)
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
            case "health": MessageBox.Show(await controller.QuickHealthAsync(id), $"Quick health {id}"); break;
            case "save":
                var saved = await controller.SaveAsync(id, false);
                MessageBox.Show($"DURABLE: {saved.CheckpointRef}", $"Save {id}");
                break;
            case "save-archive":
                var archived = await controller.SaveAsync(id, true);
                MessageBox.Show($"DURABLE + ARCHIVE: {archived.CheckpointRef}", $"Save & Archive {id}");
                break;
            case "close": await controller.SafeCloseAsync(id); break;
            case "recover": await SafeRecoverAsync(id); break;
            case "schedule-10": SetSchedule(id, 10); break;
            case "schedule-30": SetSchedule(id, 30); break;
            case "schedule-60": SetSchedule(id, 60); break;
            case "schedule-120": SetSchedule(id, 120); break;
            case "schedule-custom": SetSchedule(id, PromptMinutes()); break;
            case "schedule-cancel": settings.Schedules.Remove(id); break;
            case "dnd-on": settings.DoNotDisturb = true; break;
            case "dnd-off": settings.DoNotDisturb = false; break;
            case "advanced": ShowAdvanced(id); break;
            default: throw new InvalidOperationException("UNKNOWN_UTILITY_ACTION:" + action);
        }
        store.Save(settings);
        store.Log(id, "ACTION_OK", new { action });
        await RefreshStateAsync();
    }

    void SetSchedule(string id, int minutes)
    {
        if (minutes < 1 || minutes > 24 * 60) throw new InvalidOperationException("SCHEDULE_INTERVAL_INVALID");
        settings.Schedules[id] = new ScheduleSettings
        {
            IntervalMinutes = minutes,
            NextCheckAt = DateTimeOffset.Now.AddMinutes(minutes),
            LastFingerprint = views.TryGetValue(id, out var v) ? Fingerprint(v) : ""
        };
    }

    async Task RunSchedulesAsync()
    {
        foreach (var item in settings.Schedules.ToArray())
        {
            var sched = item.Value;
            if (sched.NextCheckAt is null || sched.NextCheckAt > DateTimeOffset.Now) continue;
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
            if (!string.Equals(fp, sched.LastFingerprint, StringComparison.Ordinal) || v.State == WorkerUiState.Blocked)
                NotifyChanged(item.Key, $"{v.State}: {v.Reason}");
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
    }

    async Task RunWatchdogAsync()
    {
        foreach (var w in Workers.All)
        {
            if (!views.TryGetValue(w.Id, out var v) || !health.TryGetValue(w.Id, out var h)) continue;
            if (h.Health == HealthBand.Blocked) { if (!settings.DoNotDisturb) NotifyChanged(w.Id, $"BLOCKED: {v.Reason}"); continue; }
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
                if (!progressed) { store.Log(w.Id, "WATCHDOG_FAIL_CLOSED", new { reason = "NO_SAFE_IDEMPOTENT_REDISPATCH_PROOF" }); NotifyChanged(w.Id, "STALLED — cần khôi phục an toàn"); }
            }
            catch (Exception ex) { watchdog.EndRecovery(w.Id, false, DateTimeOffset.Now); store.Log(w.Id, "WATCHDOG_BLOCKED", new { error = ex.Message }); NotifyChanged(w.Id, "BLOCKED: " + ex.Message); }
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
            Width = 260,
            Height = 140,
            StartPosition = FormStartPosition.CenterScreen,
            AutoScaleMode = AutoScaleMode.Dpi
        };
        var input = new NumericUpDown { Minimum = 1, Maximum = 1440, Value = 30, Left = 20, Top = 20, Width = 200 };
        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Left = 85, Top = 55 };
        form.Controls.Add(input); form.Controls.Add(ok); form.AcceptButton = ok;
        return form.ShowDialog() == DialogResult.OK ? (int)input.Value : 30;
    }

    void ShowAdvanced(string id)
    {
        views.TryGetValue(id, out var v);
        health.TryGetValue(id, out var h);
        settings.Schedules.TryGetValue(id, out var sched);
        var text = string.Join(Environment.NewLine, new[]
        {
            $"Worker: {id}", $"State: {v?.State} / {v?.Reason}",
            $"Health: {h?.Health} / no progress {h?.NoProgressFor}",
            $"Heartbeat: {v?.HeartbeatAt}", $"URL: {v?.Url}",
            $"Debug port: {Workers.Get(id).DebugPort}",
            $"Session OK: {v?.SessionOk}", $"Window open: {v?.WindowOpen}",
            $"Position locked: {settings.Workers[id].PositionLocked}",
            $"Badge offset: {settings.Workers[id].BadgeOffsetX},{settings.Workers[id].BadgeOffsetY}",
            $"Popup position: {settings.Workers[id].PopupX},{settings.Workers[id].PopupY}",
            $"Next check: {sched?.NextCheckAt}"
        });
        MessageBox.Show(text, $"Nâng cao {id}");
    }

    void ExitUtility()
    {
        timer.Stop();
        foreach (var b in badges.Values) b.Close();
        popup.Close();
        tray.Visible = false;
        tray.Dispose();
        ExitThread();
    }
}
