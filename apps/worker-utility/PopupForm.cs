namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    readonly Label header = new() { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold) };
    readonly Label status = new() { AutoSize = true };
    readonly Label job = new() { AutoSize = true };
    readonly Label schedule = new() { AutoSize = true };
    readonly TextBox logs = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 115, Width = 292 };
    readonly CheckBox dnd = new() { Text = "Không làm phiền", AutoSize = true };
    readonly FlowLayoutPanel flow = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(10) };
    readonly Func<string, string, Task> action;
    string workerId = "NV02";
    bool suppressDndEvent;

    public PopupForm(Func<string, string, Task> action)
    {
        this.action = action;
        Text = "TigerIQ Worker Utility";
        Size = new Size(330, 670);
        MinimumSize = new Size(300, 520);
        MaximumSize = new Size(360, 820);
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape) Hide(); };
        flow.Controls.Add(header);
        flow.Controls.Add(status);
        flow.Controls.Add(job);
        AddSection("Điều khiển", ("Chạy / Tiếp tục", "run"), ("Tạm dừng", "pause"));
        AddSection("Cửa sổ", ("Về vị trí", "fix"), ("Khóa vị trí", "lock"), ("Focus", "focus"));
        AddSection("Điều hướng / kiểm tra", ("Mở canonical page", "open"), ("Kiểm tra nhanh", "health"));
        AddSection("Lưu", ("Lưu", "save"), ("Lưu & Lưu trữ", "save-archive"));
        AddSection("An toàn", ("Đóng an toàn", "close"), ("Khôi phục an toàn", "recover"));
        AddSection("Lịch", ("10 phút", "schedule-10"), ("30 phút", "schedule-30"),
            ("1 giờ", "schedule-60"), ("2 giờ", "schedule-120"), ("Tùy chỉnh", "schedule-custom"), ("Hủy lịch", "schedule-cancel"));
        dnd.CheckedChanged += async (_, _) => { if (!suppressDndEvent) await action(workerId, dnd.Checked ? "dnd-on" : "dnd-off"); };
        flow.Controls.Add(dnd);
        flow.Controls.Add(schedule);
        var recent = new Label { Text = "Log gần nhất", AutoSize = true, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        flow.Controls.Add(recent);
        flow.Controls.Add(logs);
        AddSection("Nâng cao", ("Thông tin kỹ thuật", "advanced"));
        Controls.Add(flow);
    }

    void AddSection(string title, params (string Text, string Action)[] buttons)
    {
        flow.Controls.Add(new Label { Text = title, AutoSize = true, Margin = new Padding(3, 8, 3, 2), Font = new Font("Segoe UI", 9, FontStyle.Bold) });
        var row = new FlowLayoutPanel { AutoSize = true, Width = 300, WrapContents = true };
        foreach (var item in buttons)
        {
            var button = new Button { Text = item.Text, AutoSize = true, Tag = item.Action, AccessibleName = item.Text };
            button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
            row.Controls.Add(button);
        }
        flow.Controls.Add(row);
    }
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
        status.Text = $"{view.State} · {view.Reason} · {(watchdog?.Health.ToString() ?? "Unknown")}" + Environment.NewLine +
            $"Không tiến triển: {(watchdog?.NoProgressFor.ToString(@"mm\:ss") ?? "—")} · Alive: {(watchdog is null || watchdog.AliveAge == TimeSpan.MaxValue ? "—" : watchdog.AliveAge.ToString(@"mm\:ss"))}";
        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        job.Text = $"Job: {view.JobId ?? "—"} · Thời gian: {elapsed.ToString(@"hh\:mm\:ss")} · Heartbeat: {(view.HeartbeatAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—")}";
        schedule.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next
            ? $"Lần kiểm tra kế: {next.ToLocalTime():HH:mm:ss dd/MM}"
            : "Lịch: chưa đặt";
        suppressDndEvent = true;
        dnd.Checked = doNotDisturb;
        suppressDndEvent = false;
        logs.Lines = recentLogs;
        var screen = Screen.FromRectangle(anchor).WorkingArea;
        var x = Math.Min(anchor.Right - Width, screen.Right - Width);
        var y = Math.Min(anchor.Bottom + 4, screen.Bottom - Height);
        Location = new Point(Math.Max(screen.Left, x), Math.Max(screen.Top, y));
        Show();
        Activate();
    }
}
