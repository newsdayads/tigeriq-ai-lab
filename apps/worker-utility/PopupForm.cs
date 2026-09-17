namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    readonly Label header = new() { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold) };
    readonly Label stateChip = new() { AutoSize = true, Padding = new Padding(6, 3, 6, 3), Font = new Font("Segoe UI", 9, FontStyle.Bold) };
    readonly Label healthChip = new() { AutoSize = true, Padding = new Padding(6, 3, 6, 3), Font = new Font("Segoe UI", 9, FontStyle.Bold) };
    readonly Label reason = new() { AutoSize = true, MaximumSize = new Size(292, 0) };
    readonly Label job = new() { AutoSize = true, MaximumSize = new Size(292, 0) };
    readonly Label progress = new() { AutoSize = true, MaximumSize = new Size(292, 0) };
    readonly Label schedule = new() { AutoSize = true, MaximumSize = new Size(292, 0) };
    readonly TextBox logs = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 82, Width = 292, TabStop = false };
    readonly CheckBox dnd = new() { Text = "Không làm phiền", AutoSize = true, AccessibleName = "Không làm phiền" };
    readonly FlowLayoutPanel flow = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(10), TabStop = true };
    readonly FlowLayoutPanel chips = new() { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0, 2, 0, 4) };
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
        Text = "TigerIQ Worker Utility";
        ClientSize = new Size(320, 620);
        MinimumSize = new Size(300, 500);
        MaximumSize = new Size(350, 820);
        FormBorderStyle = FormBorderStyle.SizableToolWindow;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        AccessibleName = "TigerIQ Worker Utility";
        AccessibleDescription = "Popup điều khiển worker, trạng thái, job, lịch và các thao tác an toàn.";

        chips.Controls.Add(stateChip);
        chips.Controls.Add(healthChip);
        flow.Controls.Add(header);
        flow.Controls.Add(chips);
        flow.Controls.Add(reason);
        flow.Controls.Add(job);
        flow.Controls.Add(progress);
        AddSection("Điều khiển", ("Chạy / Tiếp tục", "run"), ("Tạm dừng", "pause"));
        AddSection("Cửa sổ", ("Về vị trí", "fix"), ("Khóa vị trí", "lock"), ("Focus", "focus"), ("Reset vị trí badge", "badge-reset"));
        AddSection("Điều hướng / kiểm tra", ("Mở trang chuẩn", "open"), ("Kiểm tra nhanh", "health"));
        AddSection("Lưu", ("Lưu", "save"), ("Lưu & Lưu trữ", "save-archive"));
        AddSection("An toàn", ("Đóng an toàn", "close"), ("Khôi phục an toàn", "recover"));
        AddSection("Lịch kiểm tra", ("10 phút", "schedule-10"), ("30 phút", "schedule-30"),
            ("1 giờ", "schedule-60"), ("2 giờ", "schedule-120"), ("Tùy chỉnh", "schedule-custom"), ("Hủy lịch", "schedule-cancel"));

        dnd.CheckedChanged += async (_, _) =>
        {
            if (!suppressDndEvent) await InvokeActionAsync(dnd.Checked ? "dnd-on" : "dnd-off");
        };
        flow.Controls.Add(dnd);
        flow.Controls.Add(schedule);
        flow.Controls.Add(new Label { Text = "Log gần nhất", AutoSize = true, Margin = new Padding(3, 8, 3, 2), Font = new Font("Segoe UI", 9, FontStyle.Bold) });
        flow.Controls.Add(logs);
        AddSection("Nâng cao", ("Thông tin kỹ thuật", "advanced"));
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
        var group = new GroupBox
        {
            Text = title,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Width = 296,
            Padding = new Padding(6),
            Margin = new Padding(0, 6, 0, 0),
            AccessibleName = title
        };
        var grid = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 2,
            RowCount = (buttons.Length + 1) / 2,
            Padding = new Padding(2),
            Margin = Padding.Empty
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 142));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 142));
        for (var i = 0; i < buttons.Length; i++)
        {
            var item = buttons[i];
            var button = new Button
            {
                Text = item.Text,
                Width = 136,
                Height = 31,
                Tag = item.Action,
                AccessibleName = item.Text,
                AccessibleDescription = $"Thao tác {item.Text} cho worker hiện tại",
                Margin = new Padding(2),
                UseMnemonic = false
            };
            tips.SetToolTip(button, ShortcutFor(item.Action));
            button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
            grid.Controls.Add(button, i % 2, i / 2);
        }
        group.Controls.Add(grid);
        flow.Controls.Add(group);
    }

    static string ShortcutFor(string action) => action switch
    {
        "run" => "Ctrl+R",
        "pause" => "Ctrl+P",
        "focus" => "Ctrl+F",
        "health" => "Ctrl+H",
        "save" => "Ctrl+S",
        _ => ""
    };

    async Task InvokeActionAsync(string name)
    {
        Enabled = false;
        try { await action(workerId, name); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "TigerIQ", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        finally { Enabled = true; }
    }

    public void ShowWorker(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog, WorkerSettings settings,
        ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Rectangle anchor)
    {
        workerId = worker.Id;
        header.Text = $"{worker.Id} — {worker.Name}";
        stateChip.Text = view.State.ToString().ToUpperInvariant();
        stateChip.BackColor = view.State switch
        {
            WorkerUiState.Ready => Color.Honeydew,
            WorkerUiState.Working => Color.LightGoldenrodYellow,
            WorkerUiState.Paused => Color.Gainsboro,
            _ => Color.MistyRose
        };
        var healthText = watchdog?.Health.ToString().ToUpperInvariant() ?? "UNKNOWN";
        healthChip.Text = healthText;
        healthChip.BackColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Color.Honeydew,
            HealthBand.Slow => Color.LemonChiffon,
            HealthBand.Stalled => Color.Moccasin,
            HealthBand.Recovering => Color.LightCyan,
            _ => Color.MistyRose
        };
        var noProgress = watchdog?.NoProgressFor.ToString(@"mm\:ss") ?? "—";
        var alive = watchdog is null || watchdog.AliveAge == TimeSpan.MaxValue ? "—" : watchdog.AliveAge.ToString(@"mm\:ss");
        var recovery = watchdog?.LastRecoveryAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—";
        reason.Text = $"{view.Reason} · Không tiến triển {noProgress} · Heartbeat {alive} · Recovery {recovery}";

        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        job.Text = $"Job: {view.JobId ?? "—"} · Trạng thái {elapsed.ToString(@"hh\:mm\:ss")} · HB {(view.HeartbeatAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—")}";
        progress.Text = view.State == WorkerUiState.Working
            ? "Tiến triển: chưa xác minh bởi kênh progress riêng; heartbeat/uiBusy chỉ chứng minh worker còn sống hoặc đang bận."
            : "Tiến triển: không có job WORKING cần xác minh.";
        progress.ForeColor = view.State == WorkerUiState.Working ? Color.DarkGoldenrod : SystemColors.ControlText;

        schedule.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next
            ? $"Lần kiểm tra kế: {next.ToLocalTime():HH:mm:ss dd/MM}"
            : "Lịch: chưa đặt";
        suppressDndEvent = true;
        dnd.Checked = doNotDisturb;
        suppressDndEvent = false;
        logs.Lines = recentLogs.TakeLast(10).ToArray();

        var defaultScreen = Screen.FromRectangle(anchor).WorkingArea;
        Point target;
        if (settings.PopupX is int x && settings.PopupY is int y)
        {
            var saved = new Point(x, y);
            var savedRect = new Rectangle(saved, Size);
            var matching = Screen.AllScreens.FirstOrDefault(s => s.WorkingArea.IntersectsWith(savedRect));
            target = matching is null
                ? UiPlacement.DefaultPopup(anchor, Size, defaultScreen)
                : UiPlacement.Clamp(saved, Size, matching.WorkingArea);
        }
        else
        {
            target = UiPlacement.DefaultPopup(anchor, Size, defaultScreen);
        }

        suppressPositionEvent = true;
        Location = target;
        suppressPositionEvent = false;
        if (!Visible) Show();
        Activate();
        ActiveControl = null;
    }
}
