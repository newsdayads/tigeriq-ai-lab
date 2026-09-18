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
    readonly Panel accentLine = new()
    {
        Location = new Point(10, 10),
        Size = new Size(324, 3),
        BackColor = Color.FromArgb(37, 99, 235)
    };
    readonly Label serviceIcon = new()
    {
        AutoSize = false,
        Location = new Point(18, 22),
        Size = new Size(36, 36),
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.White,
        Font = new Font("Segoe UI Symbol", 16, FontStyle.Bold)
    };
    readonly Label bell = new()
    {
        AutoSize = false,
        Location = new Point(256, 20),
        Size = new Size(28, 28),
        Text = "◉",
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(147, 197, 253),
        Font = new Font("Segoe UI Symbol", 10, FontStyle.Bold)
    };
    Color currentAccent = Color.FromArgb(37, 99, 235);
    readonly Panel headerSeparator = new()
    {
        Location = new Point(16, 100),
        Size = new Size(312, 1),
        BackColor = Color.FromArgb(31, 52, 76)
    };
    readonly Panel statusSeparator = new()
    {
        Location = new Point(16, 205),
        Size = new Size(312, 1),
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
    readonly PillLabel healthChip = new()
    {
        AutoSize = true,
        Padding = new Padding(8, 3, 8, 3),
        Font = new Font("Segoe UI", 7.5f, FontStyle.Bold)
    };
    readonly Label job = new()
    {
        AutoSize = false,
        Size = new Size(294, 15),
        ForeColor = Ink,
        Font = new Font("Segoe UI", 8.6f, FontStyle.Bold)
    };
    readonly Label reason = new()
    {
        AutoSize = false,
        Size = new Size(294, 14),
        ForeColor = Muted,
        Font = new Font("Segoe UI", 7.8f)
    };
    readonly Label progress = new()
    {
        AutoSize = false,
        Size = new Size(294, 13),
        ForeColor = Muted,
        Font = new Font("Segoe UI", 7.8f)
    };
    readonly Label actionStatus = new()
    {
        AutoSize = false,
        AutoEllipsis = true,
        Size = new Size(312, 20),
        Location = new Point(16, 210),
        ForeColor = Muted,
        Font = new Font("Segoe UI", 7.8f),
        TextAlign = ContentAlignment.MiddleLeft
    };
    readonly Label schedule = new()
    {
        AutoSize = false,
        Size = new Size(308, 18),
        ForeColor = Amber,
        Font = new Font("Segoe UI", 7.8f, FontStyle.Bold)
    };
    readonly Label logSummary = new()
    {
        AutoSize = false,
        Size = new Size(312, 82),
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

    protected override CreateParams CreateParams
    {
        get
        {
            const int CS_DROPSHADOW = 0x00020000;
            var cp = base.CreateParams;
            cp.ClassStyle |= CS_DROPSHADOW;
            return cp;
        }
    }

    public PopupForm(Func<string, string, Task> action, Action<string, Point> positionChanged)
    {
        this.action = action;
        this.positionChanged = positionChanged;

        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9);
        Text = "TigerIQ Worker Utility";
        ClientSize = new Size(344, 770);
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
        AccessibleDescription = "Bảng điều khiển worker phẳng, không thanh cuộn.";

        Controls.Add(root);
        BuildHeader();
        BuildStatus();

        var y = 236;
        AddActionSection("ĐIỀU KHIỂN", ref y,
            ("▶  Chạy / Tiếp tục", "run"),
            ("Ⅱ  Tạm dừng", "pause"));
        AddActionSection("CỬA SỔ", ref y,
            ("⌖  Về vị trí", "fix"),
            ("⌁  Khóa vị trí", "lock"));
        AddActionSection("ĐIỀU HƯỚNG & KIỂM TRA", ref y,
            ("↗  Mở đúng trang", "open"),
            ("⌕  Kiểm tra nhanh", "health"));
        AddActionSection("LƯU", ref y,
            ("▣  Lưu", "save"),
            ("▦  Lưu & Lưu trữ", "save-archive"));
        var closeMain = MakeActionButton("⏻  Đóng Chrome an toàn", "close", 312, 30);
        closeMain.Location = new Point(16, y);
        root.Controls.Add(closeMain);
        y += 39;

        BuildSchedule(ref y);
        BuildLogs(ref y);

        footerAdvanced = MakeActionButton("⚙  Nâng cao", "advanced-toggle", 312, 32);
        footerAdvanced.Location = new Point(16, 728);
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
            Location = new Point(292, 18),
            Size = new Size(28, 28),
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
            BackColor = Color.FromArgb(20, 38, 60),
            ForeColor = Color.FromArgb(203, 213, 225),
            HoverColor = Color.FromArgb(55, 65, 81),
            CornerRadius = 9,
            TabStop = false,
            AccessibleName = "Đóng bảng điều khiển"
        };
        close.Click += (_, _) => Hide();

        eyebrow.Location = new Point(62, 18);
        header.Location = new Point(62, 36);
        subtitle.Location = new Point(62, 62);
        onlineChip.Location = new Point(212, 70);

        root.Controls.Add(accentLine);
        root.Controls.Add(serviceIcon);
        root.Controls.Add(bell);
        root.Controls.Add(eyebrow);
        root.Controls.Add(header);
        root.Controls.Add(subtitle);
        root.Controls.Add(onlineChip);
        root.Controls.Add(close);
        root.Controls.Add(headerSeparator);

        foreach (Control control in new Control[] { serviceIcon, eyebrow, header, subtitle, onlineChip, bell, accentLine })
        {
            control.MouseDown += BeginHeaderDrag;
            control.MouseMove += MoveHeaderDrag;
            control.MouseUp += EndHeaderDrag;
        }
    }

    void BuildStatus()
    {
        var title = SectionTitle("TRẠNG THÁI PHIÊN");
        title.Location = new Point(20, 111);
        stateChip.Location = new Point(20, 132);
        job.Location = new Point(20, 158);
        reason.Location = new Point(20, 176);
        progress.Location = new Point(20, 193);

        var viewJob = MakeActionButton("Xem việc", "view-job", 76, 26);
        viewJob.Location = new Point(248, 154);

        root.Controls.Add(title);
        root.Controls.Add(stateChip);
        root.Controls.Add(job);
        root.Controls.Add(reason);
        root.Controls.Add(progress);
        root.Controls.Add(viewJob);
        root.Controls.Add(statusSeparator);
        root.Controls.Add(actionStatus);
    }

    void AddActionSection(string title, ref int y, params (string Text, string Action)[] buttons)
    {
        var label = SectionTitle(title);
        label.Location = new Point(16, y);
        root.Controls.Add(label);
        y += 18;

        for (var i = 0; i < buttons.Length; i++)
        {
            var row = i / 2;
            var col = i % 2;
            var button = MakeActionButton(buttons[i].Text, buttons[i].Action, 152, 30);
            button.Location = new Point(16 + col * 160, y + row * 34);
            root.Controls.Add(button);
        }
        y += ((buttons.Length + 1) / 2) * 34 + 5;
    }

    void BuildSchedule(ref int y)
    {
        var label = SectionTitle("ĐẶT LỊCH KIỂM TRA");
        label.Location = new Point(16, y);
        root.Controls.Add(label);
        y += 18;

        var entries = new[] {
            ("10p", "schedule-10", 45),
            ("30p", "schedule-30", 45),
            ("1h", "schedule-60", 45),
            ("2h", "schedule-120", 45),
            ("Tùy chỉnh", "schedule-custom", 96)
        };
        var x = 16;
        foreach (var item in entries)
        {
            var b = MakeActionButton(item.Item1, item.Item2, item.Item3, 28);
            b.Location = new Point(x, y);
            root.Controls.Add(b);
            x += item.Item3 + 4;
        }
        y += 32;

        scheduleEnabled.Location = new Point(16, y);
        changeOnly.Location = new Point(104, y);
        root.Controls.Add(scheduleEnabled);
        root.Controls.Add(changeOnly);
        y += 22;

        schedule.Location = new Point(16, y);
        root.Controls.Add(schedule);
        y += 23;
    }

    void BuildLogs(ref int y)
    {
        var label = SectionTitle("LOG GẦN NHẤT");
        label.Location = new Point(16, y);
        root.Controls.Add(label);
        y += 18;
        logSummary.Location = new Point(16, y);
        root.Controls.Add(logSummary);
        var allLogs = MakeActionButton("Xem tất cả", "logs-local", 82, 24);
        allLogs.Location = new Point(246, y - 22);
        allLogs.Click += (_, _) => ShowAllLogs();
        root.Controls.Add(allLogs);
        y += 86;
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
        ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Rectangle anchor, Rectangle[] occupied)
    {
        workerId = worker.Id;
        var accent = WorkerAccent(worker.Id);
        currentAccent = accent;
        accentLine.BackColor = accent;
        serviceIcon.BackColor = accent;
        serviceIcon.Text = worker.Id == "NV04" ? "✦" : "◎";
        eyebrow.Text = worker.Id == "NV04" ? "GEMINI" : "CHATGPT";
        header.Text = worker.Id;
        subtitle.Text = worker.Name;
        Invalidate();

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
            run.BackColor = accent;
            run.HoverColor = ControlPaint.Dark(accent, .12f);
        }

        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        stateChip.Text = $"{StateText(view.State)}     {elapsed.ToString(@"hh\:mm\:ss")}";
        job.Text = $"Job hiện tại  {view.JobId ?? "—"}";
        reason.Text = view.State switch
        {
            WorkerUiState.Working => "Đang xử lý công việc hiện tại",
            WorkerUiState.Paused => "Đã tạm dừng theo điều khiển",
            WorkerUiState.Blocked => $"Bị chặn: {view.Reason}",
            _ => "Sẵn sàng nhận việc"
        };
        progress.Text = scheduleSettings?.NextCheckAt is DateTimeOffset nextCheck && scheduleSettings.Enabled
            ? $"Lần kiểm tra kế tiếp: {nextCheck.ToLocalTime():HH:mm}"
            : "Chưa đặt lịch kiểm tra";
        progress.ForeColor = view.State == WorkerUiState.Blocked ? Red : Muted;

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

        advancedLines = BuildAdvancedLines(worker, view, watchdog, settings, scheduleSettings);
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
        WorkerSettings settings, ScheduleSettings? scheduleSettings)
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
            $"Khóa vị trí  : {(settings.PositionLocked ? "BẬT" : "TẮT")}",
            $"Lịch         : {(scheduleSettings?.Enabled == true ? $"{scheduleSettings.IntervalMinutes} phút" : "TẮT")}"
        ];
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var pen = new Pen(currentAccent, 2);
        using var path = RoundedPath(new Rectangle(1, 1, Width - 3, Height - 3), 18);
        e.Graphics.DrawPath(pen, path);
    }

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
    readonly Label title = new()
    {
        AutoSize = false,
        Location = new Point(16, 14),
        Size = new Size(388, 24),
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 11, FontStyle.Bold)
    };
    readonly Label details = new()
    {
        AutoSize = false,
        Location = new Point(16, 48),
        Size = new Size(388, 276),
        ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Consolas", 8.3f),
        BackColor = Color.FromArgb(5, 13, 25)
    };
    readonly Label status = new()
    {
        AutoSize = false,
        Location = new Point(16, 456),
        Size = new Size(388, 22),
        ForeColor = Color.FromArgb(148, 163, 184),
        Font = new Font("Segoe UI", 8.2f)
    };
    readonly Button dndButton;
    bool dndOn;

    public AdvancedInfoForm(Func<string, Task> action)
    {
        this.action = action;
        Text = "TigerIQ — Nâng cao";
        ClientSize = new Size(420, 490);
        MinimumSize = Size;
        MaximumSize = Size;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(5, 13, 25);
        Controls.Add(title);
        Controls.Add(details);

        var actions = new[]
        {
            ("◎  Focus cửa sổ", "focus"),
            ("↻  Khôi phục an toàn", "recover"),
            ("↺  Đặt lại badge", "badge-reset"),
            ("⏻  Đóng NV an toàn", "close")
        };
        for (var i = 0; i < actions.Length; i++)
        {
            var item = actions[i];
            var button = MakeButton(item.Item1, new Point(16 + (i % 2) * 196, 338 + (i / 2) * 42), 184);
            var command = item.Item2;
            button.Click += async (_, _) => await RunAsync(command);
            Controls.Add(button);
        }

        dndButton = MakeButton("Không làm phiền", new Point(16, 422), 380);
        dndButton.Click += async (_, _) =>
        {
            await RunAsync(dndOn ? "dnd-off" : "dnd-on");
            dndOn = !dndOn;
            UpdateDndText();
        };
        Controls.Add(dndButton);
        Controls.Add(status);
    }

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
            Font = new Font("Segoe UI", 8.3f, FontStyle.Bold),
            Cursor = Cursors.Hand,
            TabStop = false
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(31, 52, 76);
        button.FlatAppearance.BorderSize = 1;
        return button;
    }

    async Task RunAsync(string command)
    {
        status.Text = "Đang thực hiện…";
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
        title.Text = $"{workerId} — Nâng cao / Thông tin kỹ thuật";
        details.Text = string.Join(Environment.NewLine, lines);
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
