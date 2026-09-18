using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    static readonly Color Canvas = Color.FromArgb(5, 13, 25);
    static readonly Color Surface = Color.FromArgb(10, 22, 38);
    static readonly Color Surface2 = Color.FromArgb(14, 30, 50);
    static readonly Color Ink = Color.FromArgb(241, 245, 249);
    static readonly Color Muted = Color.FromArgb(148, 163, 184);
    static readonly Color Border = Color.FromArgb(31, 52, 76);
    static readonly Color Green = Color.FromArgb(52, 211, 153);
    static readonly Color Amber = Color.FromArgb(251, 191, 36);
    static readonly Color Red = Color.FromArgb(248, 113, 113);

    readonly Panel root = new() { Dock = DockStyle.Fill, BackColor = Canvas };
    readonly Label serviceIcon = new()
    {
        AutoSize = false,
        Location = new Point(14, 16),
        Size = new Size(40, 40),
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.White,
        Font = new Font("Segoe UI Symbol", 16, FontStyle.Bold)
    };
    readonly Label bell = new()
    {
        AutoSize = false,
        Location = new Point(232, 18),
        Size = new Size(28, 28),
        Text = "🔔",
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(147, 197, 253),
        Font = new Font("Segoe UI Emoji", 10, FontStyle.Regular)
    };
    Color currentAccent = Color.FromArgb(37, 99, 235);
    readonly Panel headerSeparator = new()
    {
        Location = new Point(14, 100),
        Size = new Size(284, 1),
        BackColor = Color.FromArgb(31, 52, 76)
    };

    readonly Label eyebrow = new()
    {
        AutoSize = true,
        Text = "NHÂN VIÊN AI",
        Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
        ForeColor = Muted
    };
    readonly Label header = new()
    {
        AutoSize = false,
        Size = new Size(184, 24),
        Font = new Font("Segoe UI", 13, FontStyle.Bold),
        ForeColor = Ink
    };
    readonly Label subtitle = new()
    {
        AutoSize = true,
        Text = "Trung tâm điều khiển Chrome thật",
        Font = new Font("Segoe UI", 8.2f),
        ForeColor = Muted
    };
    readonly PillLabel onlineChip = new()
    {
        AutoSize = true,
        Padding = new Padding(8, 3, 8, 3),
        Font = new Font("Segoe UI", 7.5f, FontStyle.Bold)
    };
    readonly PillLabel stateChip = new()
    {
        AutoSize = true,
        Padding = new Padding(8, 3, 8, 3),
        Font = new Font("Segoe UI", 7.5f, FontStyle.Bold)
    };
    readonly Label job = new()
    {
        AutoSize = false,
        AutoEllipsis = true,
        Size = new Size(190, 18),
        ForeColor = Ink,
        Font = new Font("Segoe UI", 8.6f, FontStyle.Bold)
    };
    readonly Label reason = new()
    {
        AutoSize = false,
        AutoEllipsis = true,
        Size = new Size(190, 16),
        ForeColor = Muted,
        Font = new Font("Segoe UI", 7.8f)
    };
    readonly Label progress = new()
    {
        AutoSize = false,
        AutoEllipsis = true,
        Size = new Size(284, 16),
        ForeColor = Muted,
        Font = new Font("Segoe UI", 7.8f)
    };
    readonly Label actionStatus = new()
    {
        AutoSize = false,
        AutoEllipsis = true,
        Size = new Size(284, 20),
        Location = new Point(14, 210),
        ForeColor = Muted,
        Font = new Font("Segoe UI", 7.8f),
        TextAlign = ContentAlignment.MiddleLeft
    };
    readonly Label schedule = new()
    {
        AutoSize = false,
        Size = new Size(280, 18),
        ForeColor = Amber,
        Font = new Font("Segoe UI", 7.8f, FontStyle.Bold)
    };
    readonly Label logSummary = new()
    {
        AutoSize = false,
        Size = new Size(284, 64),
        ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Consolas", 7.6f),
        BackColor = Canvas
    };

    readonly CheckBox dnd = NewCheckBox("Không làm phiền");
    readonly CheckBox scheduleEnabled = NewCheckBox("Bật lịch");
    readonly CheckBox changeOnly = NewCheckBox("Chỉ báo thay đổi/lỗi");
    readonly Dictionary<string, RoundedButton> actionButtons = new();
    readonly Func<string, string, Task> action;
    readonly Action<string, Point> positionChanged;
    readonly ToolTip tips = new();
    readonly RoundedButton footerAdvanced;
    string[] currentLogs = [];
    AdvancedInfoForm? advancedForm;
    string[] advancedLines = [];
    string workerId = "NV02";
    bool suppressDndEvent;
    bool suppressScheduleEvents;
    bool suppressPositionEvent;
    Point dragCursorStart;
    Point dragWindowStart;
    bool dragging;

    public PopupForm(Func<string, string, Task> action, Action<string, Point> positionChanged)
    {
        this.action = action;
        this.positionChanged = positionChanged;

        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9);
        Text = "TigerIQ Worker Utility";
        ClientSize = new Size(312, 650);
        MinimumSize = Size;
        MaximumSize = Size;
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        BackColor = Canvas;
        AccessibleName = "TigerIQ Worker Utility";
        AccessibleDescription = "Popup điều khiển một NV, bám đúng cửa sổ Chrome của NV đó.";

        Controls.Add(root);
        BuildHeader();
        BuildStatus();
        BuildCoreControls();
        BuildSchedule();
        BuildLogs();

        footerAdvanced = MakeActionButton("⚙  Nâng cao", "advanced-toggle", 284, 32);
        footerAdvanced.Location = new Point(14, 608);
        root.Controls.Add(footerAdvanced);

        dnd.CheckedChanged += async (_, _) =>
        {
            if (!suppressDndEvent) await InvokeActionAsync(dnd.Checked ? "dnd-on" : "dnd-off");
        };
        scheduleEnabled.CheckedChanged += async (_, _) =>
        {
            if (!suppressScheduleEvents) await InvokeActionAsync(scheduleEnabled.Checked ? "schedule-on" : "schedule-off");
        };
        changeOnly.CheckedChanged += async (_, _) =>
        {
            if (!suppressScheduleEvents) await InvokeActionAsync(changeOnly.Checked ? "schedule-change-only-on" : "schedule-change-only-off");
        };

        SizeChanged += (_, _) => ApplyRoundedRegion(this, 18);
        Shown += (_, _) => ApplyRoundedRegion(this, 18);
        KeyDown += async (_, e) =>
        {
            string? command = null;
            if (e.KeyCode == Keys.Escape) { Hide(); e.SuppressKeyPress = true; return; }
            if (e.Control && e.KeyCode == Keys.R) command = "run";
            else if (e.Control && e.KeyCode == Keys.P) command = "pause";
            else if (e.Control && e.KeyCode == Keys.F) command = "focus";
            else if (e.Control && e.KeyCode == Keys.H) command = "health";
            else if (e.Control && e.KeyCode == Keys.S) command = "save";
            if (command is null) return;
            e.SuppressKeyPress = true;
            await InvokeActionAsync(command);
        };
        Move += (_, _) =>
        {
            if (Visible && !suppressPositionEvent && !dragging) positionChanged(workerId, Location);
        };
    }

    static CheckBox NewCheckBox(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
        FlatStyle = FlatStyle.Flat,
        BackColor = Canvas,
        TabStop = false
    };

    void BuildHeader()
    {
        var close = new RoundedButton
        {
            Text = "×",
            Location = new Point(270, 16),
            Size = new Size(28, 28),
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
            BackColor = Surface,
            ForeColor = Color.FromArgb(203, 213, 225),
            HoverColor = Color.FromArgb(55, 65, 81),
            CornerRadius = 9,
            TabStop = false,
            AccessibleName = "Đóng bảng điều khiển"
        };
        close.Click += (_, _) => Hide();

        serviceIcon.Location = new Point(14, 16);
        serviceIcon.Size = new Size(40, 40);
        eyebrow.Location = new Point(64, 15);
        header.Location = new Point(64, 31);
        subtitle.Location = new Point(64, 55);
        onlineChip.Location = new Point(64, 76);
        bell.Location = new Point(232, 18);

        root.Controls.Add(serviceIcon);
        root.Controls.Add(bell);
        root.Controls.Add(eyebrow);
        root.Controls.Add(header);
        root.Controls.Add(subtitle);
        root.Controls.Add(onlineChip);
        root.Controls.Add(close);
        root.Controls.Add(headerSeparator);

        foreach (Control control in new Control[] { serviceIcon, eyebrow, header, subtitle, onlineChip, bell })
        {
            control.MouseDown += BeginHeaderDrag;
            control.MouseMove += MoveHeaderDrag;
            control.MouseUp += EndHeaderDrag;
        }
    }

    void BuildStatus()
    {
        var title = SectionTitle("TRẠNG THÁI PHIÊN");
        title.Location = new Point(14, 110);

        // Flat owner-facing status surface: no nested card.
        stateChip.Location = new Point(14, 130);
        job.Location = new Point(14, 158);
        job.Size = new Size(284, 18);
        reason.Location = new Point(14, 177);
        reason.Size = new Size(284, 16);
        progress.Location = new Point(14, 195);
        progress.Size = new Size(284, 16);
        progress.Visible = true;

        var viewJob = MakeActionButton("Xem việc", "view-job", 76, 26);
        viewJob.Location = new Point(222, 127);

        actionStatus.Location = new Point(14, 212);

        root.Controls.Add(title);
        root.Controls.Add(stateChip);
        root.Controls.Add(job);
        root.Controls.Add(reason);
        root.Controls.Add(progress);
        root.Controls.Add(viewJob);
        root.Controls.Add(actionStatus);
    }

    void BuildCoreControls()
    {
        var items = new (string Text, string Action)[]
        {
            ("▶  Chạy / Tiếp tục", "run"),
            ("Ⅱ  Tạm dừng", "pause"),
            ("⌖  Về vị trí", "fix"),
            ("⌁  Khóa vị trí", "lock"),
            ("↗  Mở đúng trang", "open"),
            ("⌕  Kiểm tra nhanh", "health"),
            ("▣  Lưu", "save"),
            ("▦  Lưu & Lưu trữ", "save-archive")
        };
        var y = 240;
        for (var i = 0; i < items.Length; i++)
        {
            var row = i / 2;
            var col = i % 2;
            var button = MakeActionButton(items[i].Text, items[i].Action, 138, 31);
            button.Location = new Point(14 + col * 146, y + row * 35);
            root.Controls.Add(button);
        }

        var closeMain = MakeActionButton("⏻  Đóng an toàn", "close", 284, 32);
        closeMain.Location = new Point(14, 382);
        root.Controls.Add(closeMain);
    }

    void BuildSchedule()
    {
        var label = SectionTitle("ĐẶT LỊCH KIỂM TRA");
        label.Location = new Point(14, 424);
        root.Controls.Add(label);

        var entries = new[] {
            ("10p", "schedule-10", 40),
            ("30p", "schedule-30", 40),
            ("1h", "schedule-60", 40),
            ("2h", "schedule-120", 40),
            ("Tùy chỉnh", "schedule-custom", 108)
        };
        var x = 14;
        foreach (var item in entries)
        {
            var b = MakeActionButton(item.Item1, item.Item2, item.Item3, 28);
            b.Location = new Point(x, 443);
            root.Controls.Add(b);
            x += item.Item3 + 4;
        }

        scheduleEnabled.Location = new Point(14, 476);
        changeOnly.Location = new Point(96, 476);
        schedule.Location = new Point(14, 497);
        root.Controls.Add(scheduleEnabled);
        root.Controls.Add(changeOnly);
        root.Controls.Add(schedule);
    }

    void BuildLogs()
    {
        var label = SectionTitle("LOG GẦN NHẤT");
        label.Location = new Point(14, 524);
        root.Controls.Add(label);

        var allLogs = MakeActionButton("Xem tất cả", "logs-local", 82, 24);
        allLogs.Location = new Point(218, 518);
        allLogs.Click += (_, _) => ShowAllLogs();
        root.Controls.Add(allLogs);

        logSummary.Location = new Point(14, 544);
        logSummary.Size = new Size(284, 56);
        root.Controls.Add(logSummary);
    }

    RoundedButton MakeActionButton(string text, string actionName, int width, int height)
    {
        var button = new RoundedButton
        {
            Text = text,
            Size = new Size(width, height),
            Tag = actionName,
            AccessibleName = text,
            AccessibleDescription = $"Thao tác {text} cho worker hiện tại",
            UseMnemonic = false,
            Cursor = Cursors.Hand,
            Font = new Font("Segoe UI", 7.9f, FontStyle.Bold),
            BackColor = ButtonBack(actionName),
            ForeColor = ButtonFore(actionName),
            HoverColor = ButtonHover(actionName),
            CornerRadius = 8,
            TabStop = false
        };
        tips.SetToolTip(button, ShortcutFor(actionName));
        if (actionName != "logs-local")
        {
            button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
            actionButtons[actionName] = button;
        }
        return button;
    }

    static Label SectionTitle(string title) => new()
    {
        Text = title,
        AutoSize = true,
        Font = new Font("Segoe UI", 7.3f, FontStyle.Bold),
        ForeColor = Color.FromArgb(100, 116, 139),
        BackColor = Canvas
    };

    static Color ButtonBack(string action) => action switch
    {
        "run" => Color.FromArgb(37, 99, 235),
        "pause" => Color.FromArgb(72, 48, 18),
        "save" or "save-archive" => Color.FromArgb(19, 47, 78),
        "close" => Color.FromArgb(74, 24, 31),
        "recover" => Color.FromArgb(13, 57, 55),
        _ => Color.FromArgb(20, 38, 60)
    };

    static Color ButtonFore(string action) => action switch
    {
        "run" => Color.White,
        "pause" => Color.FromArgb(253, 230, 138),
        "save" or "save-archive" => Color.FromArgb(191, 219, 254),
        "close" => Color.FromArgb(254, 202, 202),
        "recover" => Color.FromArgb(153, 246, 228),
        _ => Ink
    };

    static Color ButtonHover(string action) => action switch
    {
        "run" => Color.FromArgb(29, 78, 216),
        "pause" => Color.FromArgb(92, 61, 20),
        "save" or "save-archive" => Color.FromArgb(25, 64, 104),
        "close" => Color.FromArgb(103, 31, 39),
        "recover" => Color.FromArgb(17, 76, 72),
        _ => Color.FromArgb(29, 50, 75)
    };

    static string ShortcutFor(string action) => action switch
    {
        "run" => "Ctrl+R",
        "pause" => "Ctrl+P",
        "focus" => "Ctrl+F",
        "health" => "Ctrl+H",
        "save" => "Ctrl+S",
        _ => ""
    };

    static string StateText(WorkerUiState state) => state switch
    {
        WorkerUiState.Ready => "●  SẴN SÀNG",
        WorkerUiState.Working => "●  ĐANG CHẠY",
        WorkerUiState.Paused => "●  TẠM DỪNG",
        _ => "●  BỊ CHẶN"
    };

    static string HealthText(HealthBand? health) => health switch
    {
        HealthBand.Healthy => "✓  ỔN ĐỊNH",
        HealthBand.Slow => "◷  CHẬM",
        HealthBand.Stalled => "!  TREO",
        HealthBand.Recovering => "↻  KHÔI PHỤC",
        HealthBand.Blocked => "!  BỊ CHẶN",
        _ => "•  CHƯA RÕ"
    };

    static Color WorkerAccent(string id) => id switch
    {
        "NV02" => Color.FromArgb(37, 99, 235),
        "NV03" => Color.FromArgb(168, 85, 247),
        "NV04" => Color.FromArgb(6, 182, 212),
        _ => Color.FromArgb(59, 130, 246)
    };

    void BeginHeaderDrag(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        dragging = true;
        dragCursorStart = Cursor.Position;
        dragWindowStart = Location;
    }

    void MoveHeaderDrag(object? sender, MouseEventArgs e)
    {
        if (!dragging) return;
        var cursor = Cursor.Position;
        Location = new Point(
            dragWindowStart.X + cursor.X - dragCursorStart.X,
            dragWindowStart.Y + cursor.Y - dragCursorStart.Y);
    }

    void EndHeaderDrag(object? sender, MouseEventArgs e)
    {
        if (!dragging || e.Button != MouseButtons.Left) return;
        dragging = false;
        positionChanged(workerId, Location);
    }

    async Task InvokeActionAsync(string name)
    {
        if (name == "advanced-toggle")
        {
            ShowAdvanced();
            return;
        }

        SetActionNotice("Đang thực hiện…", false);
        foreach (var button in actionButtons.Values) button.Enabled = false;
        try
        {
            await action(workerId, name);
            if (actionStatus.Text == "Đang thực hiện…") SetActionNotice("✓ Hoàn tất", false);
        }
        catch (Exception ex)
        {
            SetActionNotice(FriendlyError(ex), true);
        }
        finally
        {
            foreach (var button in actionButtons.Values) button.Enabled = true;
        }
    }

    static string FriendlyError(Exception ex)
    {
        if (ex is TaskCanceledException
            || ex.Message.Contains("HttpClient.Timeout", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("CONTROLLER_TIMEOUT", StringComparison.OrdinalIgnoreCase))
            return "⚠ Controller phản hồi quá chậm. Thử lại sau.";
        var text = ex.Message.Replace("\r", " ").Replace("\n", " ").Trim();
        return text.Length > 90 ? "⚠ " + text[..87] + "…" : "⚠ " + text;
    }

    internal void SetActionNotice(string text, bool isError)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => SetActionNotice(text, isError)));
            return;
        }
        actionStatus.ForeColor = isError ? Red : (text.StartsWith("✓") ? Green : Muted);
        actionStatus.Text = text;
    }

    void ShowAdvanced()
    {
        advancedForm ??= new AdvancedInfoForm(async name => await InvokeActionAsync(name));
        advancedForm.SetWorker(workerId, advancedLines, dnd.Checked);
        if (!advancedForm.Visible) advancedForm.Show(this);
        else advancedForm.Activate();
    }

    public bool ShowWorker(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog, WorkerSettings settings,
        ScheduleSettings? scheduleSettings, HarnessView? harness, bool doNotDisturb, string[] recentLogs, Rectangle anchor, Rectangle[] occupied)
    {
        workerId = worker.Id;
        var accent = WorkerAccent(worker.Id);
        currentAccent = accent;
        serviceIcon.BackColor = accent;
        bell.Text = doNotDisturb ? "🔕" : "🔔";
        bell.ForeColor = doNotDisturb ? Amber : Color.FromArgb(147, 197, 253);
        serviceIcon.Text = worker.Id == "NV04" ? "✦" : "◎";
        eyebrow.Text = worker.Id == "NV04" ? "GEMINI" : "CHATGPT";
        header.Text = worker.Id;
        subtitle.Text = worker.Name;
        root.Invalidate();

        onlineChip.Text = view.WindowOpen && view.SessionOk ? "●  ONLINE" : "●  OFFLINE";
        onlineChip.BackColor = view.WindowOpen && view.SessionOk ? Color.FromArgb(13, 65, 49) : Color.FromArgb(74, 24, 31);
        onlineChip.ForeColor = view.WindowOpen && view.SessionOk ? Green : Red;

        stateChip.Text = StateText(view.State);
        stateChip.BackColor = view.State switch
        {
            WorkerUiState.Ready => Color.FromArgb(13, 65, 49),
            WorkerUiState.Working => Color.FromArgb(25, 58, 91),
            WorkerUiState.Paused => Color.FromArgb(72, 48, 18),
            _ => Color.FromArgb(74, 24, 31)
        };
        stateChip.ForeColor = view.State switch
        {
            WorkerUiState.Ready => Green,
            WorkerUiState.Working => Color.FromArgb(147, 197, 253),
            WorkerUiState.Paused => Amber,
            _ => Red
        };

        if (actionButtons.TryGetValue("run", out var run))
        {
            run.BackColor = view.State == WorkerUiState.Paused ? Color.FromArgb(20, 38, 60) : accent;
            run.ForeColor = Color.White;
            run.HoverColor = ControlPaint.Dark(accent, .12f);
        }
        if (actionButtons.TryGetValue("pause", out var pause))
        {
            pause.BackColor = view.State == WorkerUiState.Paused ? Color.FromArgb(120, 72, 16) : Color.FromArgb(72, 48, 18);
            pause.ForeColor = Amber;
        }
        if (actionButtons.TryGetValue("lock", out var lockButton))
        {
            lockButton.Text = settings.PositionLocked ? "⌁  Mở khóa vị trí" : "⌁  Khóa vị trí";
            lockButton.BackColor = settings.PositionLocked ? Color.FromArgb(25, 58, 91) : Color.FromArgb(20, 38, 60);
        }

        foreach (var pair in new[] { ("schedule-10", 10), ("schedule-30", 30), ("schedule-60", 60), ("schedule-120", 120) })
        {
            if (!actionButtons.TryGetValue(pair.Item1, out var scheduleButton)) continue;
            var selected = scheduleSettings?.Enabled == true && scheduleSettings.IntervalMinutes == pair.Item2;
            scheduleButton.BackColor = selected ? accent : Color.FromArgb(20, 38, 60);
            scheduleButton.ForeColor = selected ? Color.White : Ink;
        }

        var ownerView = WorkerObservability.Build(view, harness, settings, scheduleSettings, recentLogs);
        stateChip.Text = StateText(view.State);
        job.Text = $"Đang làm  {ownerView.Current}";
        reason.Text = $"Kết quả  {ownerView.Result} · {ownerView.Browser}";
        progress.Text = $"Tiếp  {ownerView.Next} · Hoạt động {ownerView.LastActivity}";
        schedule.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next && scheduleSettings.Enabled
            ? $"↪ Lần kiểm tra kế tiếp: {next.ToLocalTime():HH:mm:ss}"
            : "↪ Lịch kiểm tra: chưa bật";

        suppressDndEvent = true;
        dnd.Checked = doNotDisturb;
        suppressDndEvent = false;

        suppressScheduleEvents = true;
        scheduleEnabled.Checked = scheduleSettings?.Enabled ?? false;
        changeOnly.Checked = scheduleSettings?.ChangesOnly ?? true;
        suppressScheduleEvents = false;

        currentLogs = recentLogs;
        var visibleLogs = recentLogs.Length == 0
            ? new[] { "Chưa có log cho worker này." }
            : recentLogs.TakeLast(5).ToArray();
        logSummary.Text = string.Join(Environment.NewLine, visibleLogs);

        advancedLines = BuildAdvancedLines(worker, view, watchdog, settings, scheduleSettings, harness);
        if (advancedForm?.Visible == true) advancedForm.SetWorker(workerId, advancedLines, doNotDisturb);

        var saved = settings.PopupX is int x && settings.PopupY is int y ? new Point?(new Point(x, y)) : null;
        var workingAreas = Screen.AllScreens.Select(s => s.WorkingArea).ToArray();
        if (!UiPlacement.TryPopup(anchor, Size, workingAreas, occupied, saved, out var target))
        {
            if (Visible) Hide();
            return false;
        }

        suppressPositionEvent = true;
        Location = target;
        suppressPositionEvent = false;
        if (!Visible) Show();
        Activate();
        ActiveControl = null;
        return true;
    }

    static string[] BuildAdvancedLines(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog,
        WorkerSettings settings, ScheduleSettings? scheduleSettings, HarnessView? harness)
    {
        var heartbeat = view.HeartbeatAt?.ToLocalTime().ToString("HH:mm:ss  dd/MM") ?? "chưa có dữ liệu";
        return
        [
            $"Worker       : {worker.Id} — {worker.Name}",
            $"CDP port     : {worker.DebugPort}",
            $"Session      : {(view.SessionOk ? "OK" : "KHÔNG ĐẠT")}",
            $"Window       : {(view.WindowOpen ? "OPEN" : "CLOSED")}",
            $"UI ready     : {view.UiReady}",
            $"Heartbeat    : {heartbeat}",
            $"Login/Auth   : {(view.AuthRequired ? "CẦN ĐĂNG NHẬP" : "không yêu cầu")}",
            $"Security     : {view.SecurityBlock ?? "không có cảnh báo"}",
            $"URL          : {view.Url ?? "chưa có dữ liệu"}",
            $"Tab ID       : chưa có dữ liệu backend",
            $"Profile      : chưa có dữ liệu backend",
            $"Rate limit   : chưa có dữ liệu backend",
            $"Health       : {watchdog?.Health.ToString() ?? "chưa có dữ liệu"}",
            $"Harness      : {HarnessDisplay(harness)}",
            $"Harness check: {harness?.CheckedAt?.ToLocalTime().ToString("HH:mm:ss  dd/MM") ?? "chưa kiểm tra"}",
            $"Khóa vị trí  : {(settings.PositionLocked ? "BẬT" : "TẮT")}",
            $"Lịch         : {(scheduleSettings?.Enabled == true ? $"{scheduleSettings.IntervalMinutes} phút" : "TẮT")}"
        ];
    }

    static string HarnessDisplay(HarnessView? harness)
        => harness is null ? "chưa có dữ liệu" : $"{harness.State} · {harness.Summary}";

    void ShowAllLogs()
    {
        using var form = new Form
        {
            Text = $"{workerId} — Log gần nhất",
            Width = 680,
            Height = 480,
            StartPosition = FormStartPosition.CenterParent,
            BackColor = Canvas,
            ForeColor = Ink
        };
        var box = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Canvas,
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Consolas", 9),
            Text = currentLogs.Length == 0 ? "Chưa có log." : string.Join(Environment.NewLine, currentLogs.TakeLast(100))
        };
        form.Controls.Add(box);
        form.ShowDialog(this);
    }

    static void ApplyRoundedRegion(Control control, int radius)
    {
        if (control.Width <= 0 || control.Height <= 0) return;
        using var path = RoundedPath(new Rectangle(0, 0, control.Width, control.Height), radius);
        var old = control.Region;
        control.Region = new Region(path);
        old?.Dispose();
    }

    internal static GraphicsPath RoundedPath(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var d = Math.Max(2, radius * 2);
        var rect = new Rectangle(bounds.X, bounds.Y, Math.Max(1, bounds.Width - 1), Math.Max(1, bounds.Height - 1));
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class AdvancedInfoForm : Form
{
    readonly Func<string, Task> action;
    readonly TabControl tabs = new()
    {
        Dock = DockStyle.Fill,
        Appearance = TabAppearance.Normal,
        Font = new Font("Segoe UI", 9, FontStyle.Bold)
    };
    readonly TextBox infoBox = new()
    {
        Multiline = true,
        ReadOnly = true,
        ScrollBars = ScrollBars.Vertical,
        Dock = DockStyle.Fill,
        BorderStyle = BorderStyle.None,
        BackColor = Color.FromArgb(5, 13, 25),
        ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Consolas", 8.6f)
    };
    readonly TextBox securityBox = new()
    {
        Multiline = true,
        ReadOnly = true,
        ScrollBars = ScrollBars.Vertical,
        Dock = DockStyle.Fill,
        BorderStyle = BorderStyle.None,
        BackColor = Color.FromArgb(5, 13, 25),
        ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Consolas", 8.6f)
    };
    readonly Label status = new()
    {
        AutoSize = false,
        Dock = DockStyle.Bottom,
        Height = 28,
        ForeColor = Color.FromArgb(148, 163, 184),
        Font = new Font("Segoe UI", 8.2f),
        TextAlign = ContentAlignment.MiddleLeft
    };
    readonly Button dndButton;
    readonly Label workerTitle = new()
    {
        AutoSize = false,
        Dock = DockStyle.Top,
        Height = 42,
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 12, FontStyle.Bold),
        TextAlign = ContentAlignment.MiddleLeft,
        Padding = new Padding(12, 0, 0, 0)
    };
    string[] currentLines = [];
    bool dndOn;

    public AdvancedInfoForm(Func<string, Task> action)
    {
        this.action = action;
        Text = "TigerIQ — Nâng cao";
        ClientSize = new Size(420, 420);
        MinimumSize = Size;
        MaximumSize = Size;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(5, 13, 25);
        ForeColor = Color.White;

        var infoTab = NewTab("Thông tin");
        var optionsTab = NewTab("Tùy chọn");
        var securityTab = NewTab("Bảo mật");
        tabs.TabPages.Add(infoTab);
        tabs.TabPages.Add(optionsTab);
        tabs.TabPages.Add(securityTab);

        var infoWrap = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12), BackColor = Color.FromArgb(5, 13, 25) };
        var copy = MakeButton("Sao chép chẩn đoán", new Point(12, 286), 190);
        copy.Anchor = AnchorStyles.Left | AnchorStyles.Bottom;
        copy.Click += (_, _) =>
        {
            try
            {
                Clipboard.SetText(string.Join(Environment.NewLine, currentLines));
                status.Text = "✓ Đã sao chép chẩn đoán";
                status.ForeColor = Color.FromArgb(52, 211, 153);
            }
            catch (Exception ex)
            {
                status.Text = "⚠ " + ex.Message;
                status.ForeColor = Color.FromArgb(248, 113, 113);
            }
        };
        var harnessProbe = MakeButton("Harness + khóa an toàn", new Point(208, 286), 170);
        harnessProbe.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
        harnessProbe.Click += async (_, _) => await RunAsync("harness-lock-test");

        infoBox.Dock = DockStyle.Top;
        infoBox.Height = 272;
        infoWrap.Controls.Add(copy);
        infoWrap.Controls.Add(harnessProbe);
        infoWrap.Controls.Add(infoBox);
        infoTab.Controls.Add(infoWrap);

        var options = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(12),
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = false,
            BackColor = Color.FromArgb(5, 13, 25)
        };
        foreach (var item in new[]
        {
            ("◎  Focus cửa sổ", "focus"),
            ("▣  Chụp ảnh nhanh cửa sổ", "screenshot"),
            ("↻  Thử lại an toàn", "safe-retry"),
            ("⟳  Khôi phục cửa sổ nếu dead", "recover"),
            ("↺  Đặt lại badge", "badge-reset"),
            ("🗑  Xóa lịch làm việc", "schedule-cancel"),
            ("⏻  Đóng NV an toàn", "close")
        })
        {
            var button = MakeButton(item.Item1, Point.Empty, 355);
            var command = item.Item2;
            button.Margin = new Padding(0, 0, 0, 8);
            button.Click += async (_, _) => await RunAsync(command);
            options.Controls.Add(button);
        }

        dndButton = MakeButton("Không làm phiền", Point.Empty, 355);
        dndButton.Margin = new Padding(0, 0, 0, 8);
        dndButton.Click += async (_, _) =>
        {
            // Parent settings are authoritative. HandleActionAsync refreshes SetWorker()
            // before RunAsync returns, so locally flipping dndOn here races that refresh
            // and can make the second click send dnd-on twice.
            await RunAsync(dndOn ? "dnd-off" : "dnd-on");
            UpdateDndText();
        };
        options.Controls.Add(dndButton);
        optionsTab.Controls.Add(options);

        var securityWrap = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12), BackColor = Color.FromArgb(5, 13, 25) };
        securityWrap.Controls.Add(securityBox);
        securityTab.Controls.Add(securityWrap);

        Controls.Add(tabs);
        Controls.Add(status);
        Controls.Add(workerTitle);
    }

    static TabPage NewTab(string text) => new()
    {
        Text = text,
        BackColor = Color.FromArgb(5, 13, 25),
        ForeColor = Color.White,
        Padding = new Padding(4)
    };

    static Button MakeButton(string text, Point location, int width)
    {
        var button = new Button
        {
            Text = text,
            Location = location,
            Size = new Size(width, 34),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(20, 38, 60),
            ForeColor = Color.FromArgb(241, 245, 249),
            Font = new Font("Segoe UI", 8.8f, FontStyle.Bold),
            Cursor = Cursors.Hand,
            TabStop = false,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(10, 0, 0, 0)
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(31, 52, 76);
        button.FlatAppearance.BorderSize = 1;
        return button;
    }

    async Task RunAsync(string command)
    {
        status.Text = "Đang thực hiện…";
        status.ForeColor = Color.FromArgb(148, 163, 184);
        try
        {
            await action(command);
            status.ForeColor = Color.FromArgb(52, 211, 153);
            status.Text = "✓ Hoàn tất";
        }
        catch (Exception ex)
        {
            status.ForeColor = Color.FromArgb(248, 113, 113);
            status.Text = "⚠ " + ex.Message;
        }
    }

    void UpdateDndText()
    {
        dndButton.Text = dndOn ? "Không làm phiền: BẬT" : "Không làm phiền: TẮT";
    }

    public void SetWorker(string workerId, string[] lines, bool doNotDisturb)
    {
        workerTitle.Text = $"{workerId} — Nâng cao";
        currentLines = lines;
        infoBox.Text = string.Join(Environment.NewLine, lines);
        securityBox.Text = string.Join(Environment.NewLine, lines.Where(x =>
            x.StartsWith("Session", StringComparison.OrdinalIgnoreCase)
            || x.StartsWith("Login/Auth", StringComparison.OrdinalIgnoreCase)
            || x.StartsWith("Security", StringComparison.OrdinalIgnoreCase)
            || x.StartsWith("Rate limit", StringComparison.OrdinalIgnoreCase)
            || x.StartsWith("Heartbeat", StringComparison.OrdinalIgnoreCase)));
        dndOn = doNotDisturb;
        UpdateDndText();
    }
}

internal sealed class PillLabel : Label
{
    public PillLabel()
    {
        Resize += (_, _) => RefreshRegion();
        HandleCreated += (_, _) => RefreshRegion();
        TextChanged += (_, _) =>
        {
            if (IsHandleCreated) BeginInvoke(new Action(RefreshRegion));
        };
    }

    void RefreshRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), Height / 2);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }
}

internal sealed class RoundedButton : Button
{
    Color normalColor;
    public Color HoverColor { get; set; }
    public int CornerRadius { get; set; } = 10;

    public RoundedButton()
    {
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;
        normalColor = BackColor;
        Resize += (_, _) => RefreshRegion();
    }

    protected override void OnBackColorChanged(EventArgs e)
    {
        base.OnBackColorChanged(e);
        if (!Focused) normalColor = BackColor;
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        normalColor = BackColor;
        if (HoverColor != Color.Empty) BackColor = HoverColor;
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        BackColor = normalColor;
        base.OnMouseLeave(e);
    }

    void RefreshRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), CornerRadius);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }
}
