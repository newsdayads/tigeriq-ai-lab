namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    static readonly Color Canvas = Color.FromArgb(244, 247, 250);
    static readonly Color Card = Color.White;
    static readonly Color Ink = Color.FromArgb(28, 37, 49);
    static readonly Color Muted = Color.FromArgb(97, 108, 122);
    static readonly Color Accent = Color.FromArgb(36, 99, 235);
    static readonly Color Border = Color.FromArgb(218, 224, 232);

    readonly Label eyebrow = new() { AutoSize = true, Text = "TIGERIQ • WORKER CONTROL", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Accent };
    readonly Label header = new() { AutoSize = true, Font = new Font("Segoe UI", 14, FontStyle.Bold), ForeColor = Ink };
    readonly Label stateChip = new() { AutoSize = true, Padding = new Padding(8, 4, 8, 4), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), BorderStyle = BorderStyle.FixedSingle };
    readonly Label healthChip = new() { AutoSize = true, Padding = new Padding(8, 4, 8, 4), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), BorderStyle = BorderStyle.FixedSingle };
    readonly Label reason = new() { AutoSize = true, MaximumSize = new Size(304, 0), ForeColor = Muted };
    readonly Label job = new() { AutoSize = true, MaximumSize = new Size(304, 0), ForeColor = Ink };
    readonly Label progress = new() { AutoSize = true, MaximumSize = new Size(304, 0), ForeColor = Muted };
    readonly Label schedule = new() { AutoSize = true, MaximumSize = new Size(304, 0), ForeColor = Muted };
    readonly TextBox logs = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 78, Width = 304, TabStop = false, BorderStyle = BorderStyle.FixedSingle, BackColor = Color.FromArgb(249, 250, 252), ForeColor = Ink };
    readonly CheckBox dnd = new() { Text = "Không làm phiền", AutoSize = true, AccessibleName = "Không làm phiền", ForeColor = Ink };
    readonly FlowLayoutPanel flow = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(14, 12, 14, 14), TabStop = true, BackColor = Canvas };
    readonly FlowLayoutPanel chips = new() { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0, 4, 0, 6), BackColor = Canvas };
    readonly Func<string, string, Task> action;
    readonly Action<string, Point> positionChanged;
    readonly ToolTip tips = new();
    string workerId = "NV02";
    bool suppressDndEvent;
    bool suppressPositionEvent;

    public PopupForm(Func<string, string, Task> action, Action<string, Point> positionChanged)
    {
        this.action = action;
        this.positionChanged = positionChanged;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9);
        Text = "TigerIQ Worker Utility";
        ClientSize = new Size(336, 690);
        MinimumSize = new Size(320, 560);
        MaximumSize = new Size(350, 820);
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        BackColor = Canvas;
        AccessibleName = "TigerIQ Worker Utility";
        AccessibleDescription = "Bảng điều khiển worker, trạng thái, job, lịch và các thao tác an toàn.";

        chips.Controls.Add(stateChip);
        chips.Controls.Add(healthChip);
        flow.Controls.Add(eyebrow);
        flow.Controls.Add(header);
        flow.Controls.Add(chips);
        flow.Controls.Add(reason);
        flow.Controls.Add(job);
        flow.Controls.Add(progress);
        AddSection("ĐIỀU KHIỂN", ("▶  Chạy / Tiếp tục", "run"), ("Ⅱ  Tạm dừng", "pause"));
        AddSection("CỬA SỔ", ("↔  Về vị trí", "fix"), ("⌖  Khóa vị trí", "lock"), ("◎  Focus", "focus"), ("↺  Reset badge", "badge-reset"));
        AddSection("ĐIỀU HƯỚNG & KIỂM TRA", ("↗  Mở trang chuẩn", "open"), ("✓  Kiểm tra nhanh", "health"));
        AddSection("LƯU AN TOÀN", ("↓  Lưu", "save"), ("▣  Lưu & Lưu trữ", "save-archive"));
        AddSection("PHỤC HỒI", ("×  Đóng an toàn", "close"), ("↻  Khôi phục an toàn", "recover"));
        AddSection("LỊCH KIỂM TRA", ("10 phút", "schedule-10"), ("30 phút", "schedule-30"),
            ("1 giờ", "schedule-60"), ("2 giờ", "schedule-120"), ("Tùy chỉnh", "schedule-custom"), ("Hủy lịch", "schedule-cancel"));

        dnd.Margin = new Padding(2, 10, 0, 2);
        dnd.CheckedChanged += async (_, _) =>
        {
            if (!suppressDndEvent) await InvokeActionAsync(dnd.Checked ? "dnd-on" : "dnd-off");
        };
        flow.Controls.Add(dnd);
        flow.Controls.Add(schedule);
        flow.Controls.Add(new Label { Text = "NHẬT KÝ GẦN NHẤT", AutoSize = true, Margin = new Padding(2, 10, 3, 4), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Muted });
        flow.Controls.Add(logs);
        AddSection("NÂNG CAO", ("⚙  Thông tin kỹ thuật", "advanced"));
        Controls.Add(flow);

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
        ResizeEnd += (_, _) =>
        {
            if (Visible && !suppressPositionEvent) positionChanged(workerId, Location);
        };
    }

    void AddSection(string title, params (string Text, string Action)[] buttons)
    {
        var card = new FlowLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            MinimumSize = new Size(306, 0),
            MaximumSize = new Size(306, 0),
            Padding = new Padding(10, 8, 10, 10),
            Margin = new Padding(0, 8, 0, 0),
            BackColor = Card,
            BorderStyle = BorderStyle.FixedSingle,
            AccessibleName = title
        };
        var titleLabel = new Label
        {
            Text = title,
            AutoSize = true,
            Margin = new Padding(2, 0, 0, 6),
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            ForeColor = Muted
        };
        var grid = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 2,
            RowCount = (buttons.Length + 1) / 2,
            Margin = Padding.Empty,
            BackColor = Card
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 141));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 141));
        for (var i = 0; i < buttons.Length; i++)
        {
            var item = buttons[i];
            var button = new Button
            {
                Text = item.Text,
                Width = 135,
                Height = 34,
                Tag = item.Action,
                AccessibleName = item.Text,
                AccessibleDescription = $"Thao tác {item.Text} cho worker hiện tại",
                Margin = new Padding(2),
                UseMnemonic = false,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                BackColor = ButtonBack(item.Action),
                ForeColor = ButtonFore(item.Action)
            };
            button.FlatAppearance.BorderColor = Border;
            button.FlatAppearance.BorderSize = 1;
            tips.SetToolTip(button, ShortcutFor(item.Action));
            button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
            grid.Controls.Add(button, i % 2, i / 2);
        }
        card.Controls.Add(titleLabel);
        card.Controls.Add(grid);
        flow.Controls.Add(card);
    }

    static Color ButtonBack(string action) => action switch
    {
        "run" => Color.FromArgb(226, 248, 236),
        "pause" => Color.FromArgb(255, 244, 219),
        "save" or "save-archive" => Color.FromArgb(231, 239, 255),
        "close" => Color.FromArgb(255, 236, 236),
        "recover" => Color.FromArgb(232, 247, 244),
        _ => Color.FromArgb(248, 250, 252)
    };

    static Color ButtonFore(string action) => action switch
    {
        "run" => Color.FromArgb(23, 111, 67),
        "pause" => Color.FromArgb(151, 93, 0),
        "save" or "save-archive" => Color.FromArgb(28, 78, 170),
        "close" => Color.FromArgb(176, 42, 42),
        "recover" => Color.FromArgb(15, 105, 91),
        _ => Ink
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
        WorkerUiState.Ready => "SẴN SÀNG",
        WorkerUiState.Working => "ĐANG LÀM",
        WorkerUiState.Paused => "TẠM DỪNG",
        _ => "BỊ CHẶN"
    };

    static string HealthText(HealthBand? health) => health switch
    {
        HealthBand.Healthy => "ỔN ĐỊNH",
        HealthBand.Slow => "CHẬM",
        HealthBand.Stalled => "TREO",
        HealthBand.Recovering => "ĐANG KHÔI PHỤC",
        HealthBand.Blocked => "BỊ CHẶN",
        _ => "CHƯA RÕ"
    };

    async Task InvokeActionAsync(string name)
    {
        Enabled = false;
        try { await action(workerId, name); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "TigerIQ", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        finally { Enabled = true; }
    }

    public bool ShowWorker(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog, WorkerSettings settings,
        ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Rectangle anchor, Rectangle[] occupied)
    {
        workerId = worker.Id;
        header.Text = $"{worker.Id}  ·  {worker.Name}";
        stateChip.Text = StateText(view.State);
        stateChip.BackColor = view.State switch
        {
            WorkerUiState.Ready => Color.FromArgb(226, 248, 236),
            WorkerUiState.Working => Color.FromArgb(255, 244, 219),
            WorkerUiState.Paused => Color.FromArgb(237, 240, 244),
            _ => Color.FromArgb(255, 236, 236)
        };
        stateChip.ForeColor = view.State switch
        {
            WorkerUiState.Ready => Color.FromArgb(23, 111, 67),
            WorkerUiState.Working => Color.FromArgb(151, 93, 0),
            WorkerUiState.Paused => Color.FromArgb(79, 88, 99),
            _ => Color.FromArgb(176, 42, 42)
        };
        healthChip.Text = HealthText(watchdog?.Health);
        healthChip.BackColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Color.FromArgb(226, 248, 236),
            HealthBand.Slow => Color.FromArgb(255, 244, 219),
            HealthBand.Stalled => Color.FromArgb(255, 234, 212),
            HealthBand.Recovering => Color.FromArgb(226, 243, 255),
            _ => Color.FromArgb(255, 236, 236)
        };
        healthChip.ForeColor = Ink;

        var noProgress = watchdog?.NoProgressFor.ToString(@"mm\:ss") ?? "—";
        var alive = watchdog is null || watchdog.AliveAge == TimeSpan.MaxValue ? "—" : watchdog.AliveAge.ToString(@"mm\:ss");
        var recovery = watchdog?.LastRecoveryAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—";
        reason.Text = $"{view.Reason}  •  không tiến triển {noProgress}  •  heartbeat {alive}  •  khôi phục {recovery}";

        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        job.Text = $"Job: {view.JobId ?? "—"}   |   Trạng thái: {elapsed.ToString(@"hh\:mm\:ss")}   |   HB: {(view.HeartbeatAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—")}";
        progress.Text = view.State == WorkerUiState.Working
            ? "Tiến triển: đang chờ bằng chứng progress riêng; heartbeat/uiBusy chỉ xác nhận worker còn sống hoặc đang bận."
            : "Tiến triển: không có job đang chạy cần xác minh.";
        progress.ForeColor = view.State == WorkerUiState.Working ? Color.FromArgb(151, 93, 0) : Muted;

        schedule.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next
            ? $"Lần kiểm tra kế: {next.ToLocalTime():HH:mm:ss dd/MM}"
            : "Lịch: chưa đặt";
        suppressDndEvent = true;
        dnd.Checked = doNotDisturb;
        suppressDndEvent = false;
        logs.Lines = recentLogs.TakeLast(10).ToArray();

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
}
