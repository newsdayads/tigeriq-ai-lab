using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    static readonly Color Canvas = Color.FromArgb(5, 13, 25);
    static readonly Color Card = Color.FromArgb(12, 25, 43);
    static readonly Color CardAlt = Color.FromArgb(9, 20, 35);
    static readonly Color Ink = Color.FromArgb(241, 245, 249);
    static readonly Color Muted = Color.FromArgb(148, 163, 184);
    static readonly Color Border = Color.FromArgb(31, 52, 76);
    static readonly Color Green = Color.FromArgb(52, 211, 153);
    static readonly Color Amber = Color.FromArgb(251, 191, 36);
    static readonly Color Red = Color.FromArgb(248, 113, 113);
    static readonly Color Teal = Color.FromArgb(45, 212, 191);

    readonly Label eyebrow = new() { AutoSize = true, Text = "TIGERIQ  /  WORKER CONTROL", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Color.FromArgb(148, 163, 184) };
    readonly Label workerGlyph = new() { AutoSize = false, Size = new Size(44, 44), TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 16, FontStyle.Bold), ForeColor = Color.White };
    readonly Label header = new() { AutoSize = true, Font = new Font("Segoe UI", 14, FontStyle.Bold), ForeColor = Color.White };
    readonly Label subtitle = new() { AutoSize = true, Text = "Trung tâm điều khiển Chrome thật", Font = new Font("Segoe UI", 8.5f), ForeColor = Muted };
    readonly PillLabel onlineChip = new() { AutoSize = true, Padding = new Padding(9, 4, 9, 4), Font = new Font("Segoe UI", 8, FontStyle.Bold) };
    readonly PillLabel stateChip = new() { AutoSize = true, Padding = new Padding(9, 4, 9, 4), Font = new Font("Segoe UI", 8, FontStyle.Bold) };
    readonly PillLabel healthChip = new() { AutoSize = true, Padding = new Padding(9, 4, 9, 4), Font = new Font("Segoe UI", 8, FontStyle.Bold) };
    readonly Label reason = new() { AutoSize = true, MaximumSize = new Size(284, 0), ForeColor = Muted, Font = new Font("Segoe UI", 8.3f) };
    readonly Label job = new() { AutoSize = true, MaximumSize = new Size(284, 0), ForeColor = Ink, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
    readonly Label progress = new() { AutoSize = true, MaximumSize = new Size(284, 0), ForeColor = Muted, Font = new Font("Segoe UI", 8.3f) };
    readonly Label schedule = new() { AutoSize = true, MaximumSize = new Size(284, 0), ForeColor = Amber, Font = new Font("Segoe UI", 8.3f, FontStyle.Bold) };
    readonly TextBox logs = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 94, Width = 286, TabStop = false, BorderStyle = BorderStyle.None, BackColor = Color.FromArgb(4, 10, 20), ForeColor = Color.FromArgb(203, 213, 225), Font = new Font("Consolas", 8.3f) };
    readonly TextBox advancedInfo = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 150, Width = 286, TabStop = false, BorderStyle = BorderStyle.None, BackColor = Color.FromArgb(4, 10, 20), ForeColor = Color.FromArgb(203, 213, 225), Font = new Font("Consolas", 8.3f) };
    readonly CheckBox dnd = NewCheckBox("Không làm phiền");
    readonly CheckBox scheduleEnabled = NewCheckBox("Bật lịch kiểm tra");
    readonly CheckBox changeOnly = NewCheckBox("Chỉ báo khi có thay đổi/lỗi");
    readonly FlowLayoutPanel flow = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(14, 14, 14, 16), TabStop = true, BackColor = Canvas };
    readonly FlowLayoutPanel chips = new() { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Margin = new Padding(0, 8, 0, 8), BackColor = Card };
    readonly Dictionary<string, RoundedButton> actionButtons = new();
    readonly Func<string, string, Task> action;
    readonly Action<string, Point> positionChanged;
    readonly ToolTip tips = new();
    readonly RoundedPanel headerCard;
    readonly RoundedPanel advancedCard;
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
        ClientSize = new Size(346, 700);
        MinimumSize = new Size(330, 600);
        MaximumSize = new Size(360, 820);
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
        AccessibleDescription = "Bảng điều khiển worker, trạng thái, job, lịch, log và thao tác an toàn.";

        headerCard = BuildBrandHeader();
        advancedCard = BuildAdvancedCard();
        flow.Controls.Add(headerCard);
        flow.Controls.Add(BuildStatusHero());
        AddSection("ĐIỀU KHIỂN", ("▶  Chạy / Tiếp tục", "run"), ("Ⅱ  Tạm dừng", "pause"));
        AddSection("CỬA SỔ", ("⌖  Về vị trí", "fix"), ("⌁  Khóa vị trí", "lock"), ("◎  Focus", "focus"), ("↺  Reset badge", "badge-reset"));
        AddSection("ĐIỀU HƯỚNG & KIỂM TRA", ("↗  Mở đúng trang", "open"), ("⌕  Kiểm tra nhanh", "health"));
        AddSection("LƯU AN TOÀN", ("▣  Lưu", "save"), ("▦  Lưu & Lưu trữ", "save-archive"));
        AddSection("PHỤC HỒI", ("⏻  Đóng an toàn", "close"), ("↻  Khôi phục", "recover"));
        flow.Controls.Add(BuildScheduleCard());
        flow.Controls.Add(BuildLogCard());
        AddSection("NÂNG CAO", ("⚙  Thông tin kỹ thuật", "advanced-toggle"));
        flow.Controls.Add(advancedCard);
        Controls.Add(flow);

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
        Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
        FlatStyle = FlatStyle.Flat,
        Margin = new Padding(2, 3, 0, 3)
    };

    RoundedPanel BuildBrandHeader()
    {
        var card = new RoundedPanel
        {
            Width = 310,
            Height = 116,
            Margin = new Padding(0, 0, 0, 10),
            Padding = new Padding(14),
            BackColor = Color.FromArgb(8, 19, 34),
            BorderColor = Color.FromArgb(37, 99, 235),
            BorderWidth = 2,
            CornerRadius = 16,
            AccessibleName = "TigerIQ worker header"
        };
        var close = new RoundedButton
        {
            Text = "×",
            Size = new Size(30, 30),
            Location = new Point(264, 12),
            Font = new Font("Segoe UI", 13, FontStyle.Bold),
            BackColor = Color.FromArgb(20, 38, 60),
            ForeColor = Color.FromArgb(203, 213, 225),
            HoverColor = Color.FromArgb(42, 62, 86),
            CornerRadius = 10,
            TabStop = false,
            AccessibleName = "Đóng bảng điều khiển"
        };
        close.Click += (_, _) => Hide();
        workerGlyph.Location = new Point(15, 42);
        workerGlyph.BackColor = Color.FromArgb(37, 99, 235);
        eyebrow.Location = new Point(15, 13);
        header.Location = new Point(68, 39);
        subtitle.Location = new Point(69, 66);
        onlineChip.Location = new Point(69, 84);
        card.Controls.Add(eyebrow);
        card.Controls.Add(workerGlyph);
        card.Controls.Add(header);
        card.Controls.Add(subtitle);
        card.Controls.Add(onlineChip);
        card.Controls.Add(close);
        card.MouseDown += BeginHeaderDrag;
        card.MouseMove += MoveHeaderDrag;
        card.MouseUp += EndHeaderDrag;
        foreach (Control control in new Control[] { eyebrow, header, subtitle, workerGlyph })
        {
            control.MouseDown += BeginHeaderDrag;
            control.MouseMove += MoveHeaderDrag;
            control.MouseUp += EndHeaderDrag;
        }
        return card;
    }

    Control BuildStatusHero()
    {
        var card = NewCard();
        var title = SectionTitle("TRẠNG THÁI PHIÊN");
        chips.Controls.Add(stateChip);
        chips.Controls.Add(healthChip);
        card.Controls.Add(title);
        card.Controls.Add(chips);
        card.Controls.Add(job);
        card.Controls.Add(reason);
        card.Controls.Add(progress);
        return card;
    }

    RoundedPanel BuildScheduleCard()
    {
        var card = NewCard();
        card.Controls.Add(SectionTitle("ĐẶT LỊCH KIỂM TRA"));
        var grid = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 5,
            RowCount = 1,
            Margin = new Padding(0, 0, 0, 5),
            BackColor = Card
        };
        foreach (var width in new[] { 53, 53, 53, 53, 70 }) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, width));
        var entries = new[] {
            ("10p", "schedule-10"), ("30p", "schedule-30"), ("1h", "schedule-60"),
            ("2h", "schedule-120"), ("Tùy chỉnh", "schedule-custom")
        };
        for (var i = 0; i < entries.Length; i++)
        {
            var item = entries[i];
            var b = MakeActionButton(item.Item1, item.Item2, i == 4 ? 66 : 49, 32);
            grid.Controls.Add(b, i, 0);
        }
        card.Controls.Add(grid);
        card.Controls.Add(scheduleEnabled);
        card.Controls.Add(changeOnly);
        card.Controls.Add(dnd);
        card.Controls.Add(schedule);
        return card;
    }

    RoundedPanel BuildLogCard()
    {
        var card = NewCard();
        card.Controls.Add(SectionTitle("NHẬT KÝ GẦN NHẤT"));
        var shell = new RoundedPanel
        {
            Width = 290,
            Height = 108,
            Padding = new Padding(8, 7, 8, 7),
            Margin = new Padding(0, 4, 0, 0),
            BackColor = Color.FromArgb(4, 10, 20),
            BorderColor = Border,
            CornerRadius = 10
        };
        logs.Dock = DockStyle.Fill;
        shell.Controls.Add(logs);
        card.Controls.Add(shell);
        return card;
    }

    RoundedPanel BuildAdvancedCard()
    {
        var card = NewCard();
        card.Visible = false;
        card.Controls.Add(SectionTitle("THÔNG TIN KỸ THUẬT"));
        var shell = new RoundedPanel
        {
            Width = 290,
            Height = 164,
            Padding = new Padding(8, 7, 8, 7),
            Margin = new Padding(0, 4, 0, 0),
            BackColor = Color.FromArgb(4, 10, 20),
            BorderColor = Border,
            CornerRadius = 10
        };
        advancedInfo.Dock = DockStyle.Fill;
        shell.Controls.Add(advancedInfo);
        card.Controls.Add(shell);
        return card;
    }

    RoundedPanel NewCard() => new()
    {
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        MinimumSize = new Size(310, 0),
        MaximumSize = new Size(310, 0),
        Padding = new Padding(10, 10, 10, 11),
        Margin = new Padding(0, 7, 0, 0),
        BackColor = Card,
        BorderColor = Border,
        CornerRadius = 14
    };

    static Label SectionTitle(string title) => new()
    {
        Text = title,
        AutoSize = true,
        Margin = new Padding(2, 0, 0, 6),
        Font = new Font("Segoe UI", 7.8f, FontStyle.Bold),
        ForeColor = Color.FromArgb(100, 116, 139)
    };

    void AddSection(string title, params (string Text, string Action)[] buttons)
    {
        var card = NewCard();
        card.AccessibleName = title;
        var grid = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 2,
            RowCount = (buttons.Length + 1) / 2,
            Margin = Padding.Empty,
            BackColor = Card
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 143));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 143));
        for (var i = 0; i < buttons.Length; i++)
        {
            var item = buttons[i];
            grid.Controls.Add(MakeActionButton(item.Text, item.Action, 137, 36), i % 2, i / 2);
        }
        card.Controls.Add(SectionTitle(title));
        card.Controls.Add(grid);
        flow.Controls.Add(card);
    }

    RoundedButton MakeActionButton(string text, string actionName, int width, int height)
    {
        var button = new RoundedButton
        {
            Text = text,
            Width = width,
            Height = height,
            Tag = actionName,
            AccessibleName = text,
            AccessibleDescription = $"Thao tác {text} cho worker hiện tại",
            Margin = new Padding(2, 3, 2, 3),
            UseMnemonic = false,
            Cursor = Cursors.Hand,
            Font = new Font("Segoe UI", 8.2f, FontStyle.Bold),
            BackColor = ButtonBack(actionName),
            ForeColor = ButtonFore(actionName),
            HoverColor = ButtonHover(actionName),
            CornerRadius = 9
        };
        tips.SetToolTip(button, ShortcutFor(actionName));
        button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
        actionButtons[actionName] = button;
        return button;
    }

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

    static string WorkerGlyph(string id) => id switch
    {
        "NV02" => "◎",
        "NV03" => "◉",
        "NV04" => "✦",
        _ => "●"
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
        Location = new Point(dragWindowStart.X + cursor.X - dragCursorStart.X, dragWindowStart.Y + cursor.Y - dragCursorStart.Y);
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
            advancedCard.Visible = !advancedCard.Visible;
            return;
        }
        Enabled = false;
        try { await action(workerId, name); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "TigerIQ", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        finally { Enabled = true; }
    }

    public bool ShowWorker(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog, WorkerSettings settings,
        ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Rectangle anchor, Rectangle[] occupied)
    {
        workerId = worker.Id;
        var accent = WorkerAccent(worker.Id);
        headerCard.BorderColor = accent;
        workerGlyph.BackColor = accent;
        workerGlyph.Text = WorkerGlyph(worker.Id);
        header.Text = $"{worker.Id}  ·  {worker.Name}";

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

        healthChip.Text = HealthText(watchdog?.Health);
        healthChip.BackColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Color.FromArgb(13, 65, 49),
            HealthBand.Slow => Color.FromArgb(72, 48, 18),
            HealthBand.Stalled => Color.FromArgb(74, 24, 31),
            HealthBand.Recovering => Color.FromArgb(25, 58, 91),
            HealthBand.Blocked => Color.FromArgb(74, 24, 31),
            _ => Color.FromArgb(20, 38, 60)
        };
        healthChip.ForeColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Green,
            HealthBand.Slow => Amber,
            HealthBand.Recovering => Color.FromArgb(147, 197, 253),
            HealthBand.Stalled or HealthBand.Blocked => Red,
            _ => Muted
        };

        if (actionButtons.TryGetValue("run", out var run))
        {
            run.BackColor = accent;
            run.HoverColor = ControlPaint.Dark(accent, .12f);
        }

        var noProgress = watchdog?.NoProgressFor.ToString(@"mm\:ss") ?? "—";
        var alive = watchdog is null || watchdog.AliveAge == TimeSpan.MaxValue ? "—" : watchdog.AliveAge.ToString(@"mm\:ss");
        var recovery = watchdog?.LastRecoveryAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—";
        reason.Text = $"{view.Reason}  ·  im lặng {noProgress}  ·  heartbeat {alive}  ·  phục hồi {recovery}";

        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        job.Text = $"Job hiện tại   {view.JobId ?? "—"}     {elapsed.ToString(@"hh\:mm\:ss")}";
        progress.Text = view.State == WorkerUiState.Working
            ? "Đang xử lý — chỉ hiển thị dữ liệu đã xác minh từ bộ điều khiển."
            : "Không có job đang chạy cần xác minh.";
        progress.ForeColor = view.State == WorkerUiState.Working ? Color.FromArgb(147, 197, 253) : Muted;

        schedule.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next && scheduleSettings.Enabled
            ? $"↪  Lần kiểm tra kế tiếp: {next.ToLocalTime():HH:mm:ss  dd/MM}"
            : "↪  Lịch kiểm tra: chưa bật";

        suppressDndEvent = true;
        dnd.Checked = doNotDisturb;
        suppressDndEvent = false;

        suppressScheduleEvents = true;
        scheduleEnabled.Checked = scheduleSettings?.Enabled ?? false;
        changeOnly.Checked = scheduleSettings?.ChangesOnly ?? true;
        suppressScheduleEvents = false;

        logs.Lines = recentLogs.Length == 0 ? ["Chưa có log cho worker này."] : recentLogs.TakeLast(10).ToArray();
        advancedInfo.Lines = BuildAdvancedLines(worker, view, watchdog, settings, scheduleSettings);

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

internal sealed class RoundedPanel : FlowLayoutPanel
{
    public int CornerRadius { get; set; } = 12;
    public Color BorderColor { get; set; } = Color.Transparent;
    public int BorderWidth { get; set; } = 1;

    public RoundedPanel()
    {
        DoubleBuffered = true;
        Resize += (_, _) => RefreshRegion();
    }

    void RefreshRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), CornerRadius);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), CornerRadius);
        using var pen = new Pen(BorderColor, BorderWidth);
        e.Graphics.DrawPath(pen, path);
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
