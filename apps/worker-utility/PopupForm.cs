using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    static readonly Color Canvas = Color.FromArgb(241, 245, 249);
    static readonly Color Card = Color.White;
    static readonly Color Ink = Color.FromArgb(15, 23, 42);
    static readonly Color Muted = Color.FromArgb(100, 116, 139);
    static readonly Color Accent = Color.FromArgb(37, 99, 235);
    static readonly Color AccentDark = Color.FromArgb(30, 64, 175);
    static readonly Color Navy = Color.FromArgb(15, 23, 42);
    static readonly Color Border = Color.FromArgb(226, 232, 240);
    static readonly Color Green = Color.FromArgb(5, 150, 105);
    static readonly Color Amber = Color.FromArgb(217, 119, 6);
    static readonly Color Red = Color.FromArgb(220, 38, 38);
    static readonly Color Teal = Color.FromArgb(13, 148, 136);

    readonly Label eyebrow = new() { AutoSize = true, Text = "TIGERIQ  /  WORKER CONTROL", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Color.FromArgb(147, 197, 253) };
    readonly Label header = new() { AutoSize = true, Font = new Font("Segoe UI", 16, FontStyle.Bold), ForeColor = Color.White };
    readonly Label subtitle = new() { AutoSize = true, Text = "Trung tâm điều khiển phiên Chrome", Font = new Font("Segoe UI", 8.5f), ForeColor = Color.FromArgb(203, 213, 225) };
    readonly PillLabel stateChip = new() { AutoSize = true, Padding = new Padding(10, 5, 10, 5), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    readonly PillLabel healthChip = new() { AutoSize = true, Padding = new Padding(10, 5, 10, 5), Font = new Font("Segoe UI", 8.5f, FontStyle.Bold) };
    readonly Label reason = new() { AutoSize = true, MaximumSize = new Size(282, 0), ForeColor = Muted, Font = new Font("Segoe UI", 8.5f) };
    readonly Label job = new() { AutoSize = true, MaximumSize = new Size(282, 0), ForeColor = Ink, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
    readonly Label progress = new() { AutoSize = true, MaximumSize = new Size(282, 0), ForeColor = Muted, Font = new Font("Segoe UI", 8.5f) };
    readonly Label schedule = new() { AutoSize = true, MaximumSize = new Size(282, 0), ForeColor = Muted, Font = new Font("Segoe UI", 8.5f) };
    readonly TextBox logs = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 82, Width = 282, TabStop = false, BorderStyle = BorderStyle.None, BackColor = Color.FromArgb(15, 23, 42), ForeColor = Color.FromArgb(226, 232, 240), Font = new Font("Consolas", 8.5f) };
    readonly CheckBox dnd = new() { Text = "Không làm phiền", AutoSize = true, AccessibleName = "Không làm phiền", ForeColor = Ink, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
    readonly FlowLayoutPanel flow = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(14, 14, 14, 16), TabStop = true, BackColor = Canvas };
    readonly FlowLayoutPanel chips = new() { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0, 8, 0, 8), BackColor = Card };
    readonly Func<string, string, Task> action;
    readonly Action<string, Point> positionChanged;
    readonly ToolTip tips = new();
    string workerId = "NV02";
    bool suppressDndEvent;
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
        ClientSize = new Size(344, 716);
        MinimumSize = new Size(328, 580);
        MaximumSize = new Size(360, 840);
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
        AccessibleDescription = "Bảng điều khiển worker, trạng thái, job, lịch và các thao tác an toàn.";

        flow.Controls.Add(BuildBrandHeader());
        flow.Controls.Add(BuildStatusHero());
        AddSection("ĐIỀU KHIỂN", ("▶  Chạy / Tiếp tục", "run"), ("Ⅱ  Tạm dừng", "pause"));
        AddSection("CỬA SỔ", ("↔  Về vị trí", "fix"), ("⌖  Khóa vị trí", "lock"), ("◎  Focus", "focus"), ("↺  Reset badge", "badge-reset"));
        AddSection("ĐIỀU HƯỚNG & KIỂM TRA", ("↗  Mở trang chuẩn", "open"), ("✓  Kiểm tra nhanh", "health"));
        AddSection("LƯU AN TOÀN", ("↓  Lưu", "save"), ("▣  Lưu & Lưu trữ", "save-archive"));
        AddSection("PHỤC HỒI", ("×  Đóng an toàn", "close"), ("↻  Khôi phục an toàn", "recover"));
        AddSection("LỊCH KIỂM TRA", ("10 phút", "schedule-10"), ("30 phút", "schedule-30"),
            ("1 giờ", "schedule-60"), ("2 giờ", "schedule-120"), ("Tùy chỉnh", "schedule-custom"), ("Hủy lịch", "schedule-cancel"));

        var preferenceCard = NewCard();
        dnd.Margin = new Padding(2, 2, 0, 4);
        dnd.CheckedChanged += async (_, _) =>
        {
            if (!suppressDndEvent) await InvokeActionAsync(dnd.Checked ? "dnd-on" : "dnd-off");
        };
        preferenceCard.Controls.Add(dnd);
        preferenceCard.Controls.Add(schedule);
        flow.Controls.Add(preferenceCard);

        var logCard = NewCard();
        logCard.Controls.Add(SectionTitle("NHẬT KÝ GẦN NHẤT"));
        var logShell = new RoundedPanel
        {
            Width = 286,
            Height = 94,
            Padding = new Padding(8, 7, 8, 7),
            Margin = new Padding(0, 4, 0, 0),
            BackColor = Navy,
            BorderColor = Color.FromArgb(30, 41, 59),
            CornerRadius = 10
        };
        logs.Dock = DockStyle.Fill;
        logShell.Controls.Add(logs);
        logCard.Controls.Add(logShell);
        flow.Controls.Add(logCard);
        AddSection("NÂNG CAO", ("⚙  Thông tin kỹ thuật", "advanced"));
        Controls.Add(flow);

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

    Control BuildBrandHeader()
    {
        var card = new RoundedPanel
        {
            Width = 306,
            Height = 106,
            Margin = new Padding(0, 0, 0, 10),
            Padding = new Padding(16, 14, 14, 12),
            BackColor = Navy,
            BorderColor = Navy,
            CornerRadius = 16,
            AccessibleName = "TigerIQ worker header"
        };
        var close = new RoundedButton
        {
            Text = "×",
            Size = new Size(30, 30),
            Location = new Point(260, 12),
            Font = new Font("Segoe UI", 13, FontStyle.Bold),
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.FromArgb(203, 213, 225),
            HoverColor = Color.FromArgb(51, 65, 85),
            CornerRadius = 10,
            TabStop = false,
            AccessibleName = "Đóng bảng điều khiển"
        };
        close.Click += (_, _) => Hide();
        eyebrow.Location = new Point(16, 16);
        header.Location = new Point(16, 39);
        subtitle.Location = new Point(16, 72);
        card.Controls.Add(eyebrow);
        card.Controls.Add(header);
        card.Controls.Add(subtitle);
        card.Controls.Add(close);
        card.MouseDown += BeginHeaderDrag;
        card.MouseMove += MoveHeaderDrag;
        card.MouseUp += EndHeaderDrag;
        foreach (Control control in new Control[] { eyebrow, header, subtitle })
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
        card.Margin = new Padding(0, 0, 0, 2);
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

    RoundedPanel NewCard() => new()
    {
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        MinimumSize = new Size(306, 0),
        MaximumSize = new Size(306, 0),
        Padding = new Padding(10, 10, 10, 11),
        Margin = new Padding(0, 8, 0, 0),
        BackColor = Card,
        BorderColor = Border,
        CornerRadius = 14
    };

    static Label SectionTitle(string title) => new()
    {
        Text = title,
        AutoSize = true,
        Margin = new Padding(2, 0, 0, 6),
        Font = new Font("Segoe UI", 8, FontStyle.Bold),
        ForeColor = Color.FromArgb(71, 85, 105)
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
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 141));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 141));
        for (var i = 0; i < buttons.Length; i++)
        {
            var item = buttons[i];
            var button = new RoundedButton
            {
                Text = item.Text,
                Width = 135,
                Height = 36,
                Tag = item.Action,
                AccessibleName = item.Text,
                AccessibleDescription = $"Thao tác {item.Text} cho worker hiện tại",
                Margin = new Padding(2, 3, 2, 3),
                UseMnemonic = false,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                BackColor = ButtonBack(item.Action),
                ForeColor = ButtonFore(item.Action),
                HoverColor = ButtonHover(item.Action),
                CornerRadius = 10
            };
            tips.SetToolTip(button, ShortcutFor(item.Action));
            button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
            grid.Controls.Add(button, i % 2, i / 2);
        }
        card.Controls.Add(SectionTitle(title));
        card.Controls.Add(grid);
        flow.Controls.Add(card);
    }

    static Color ButtonBack(string action) => action switch
    {
        "run" => Accent,
        "pause" => Color.FromArgb(255, 247, 237),
        "save" or "save-archive" => Color.FromArgb(239, 246, 255),
        "close" => Color.FromArgb(254, 242, 242),
        "recover" => Color.FromArgb(240, 253, 250),
        _ => Color.FromArgb(248, 250, 252)
    };

    static Color ButtonFore(string action) => action switch
    {
        "run" => Color.White,
        "pause" => Amber,
        "save" or "save-archive" => AccentDark,
        "close" => Red,
        "recover" => Teal,
        _ => Ink
    };

    static Color ButtonHover(string action) => action switch
    {
        "run" => AccentDark,
        "pause" => Color.FromArgb(255, 237, 213),
        "save" or "save-archive" => Color.FromArgb(219, 234, 254),
        "close" => Color.FromArgb(254, 226, 226),
        "recover" => Color.FromArgb(204, 251, 241),
        _ => Color.FromArgb(241, 245, 249)
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
        WorkerUiState.Working => "▶  ĐANG LÀM",
        WorkerUiState.Paused => "Ⅱ  TẠM DỪNG",
        _ => "!  BỊ CHẶN"
    };

    static string HealthText(HealthBand? health) => health switch
    {
        HealthBand.Healthy => "✓  ỔN ĐỊNH",
        HealthBand.Slow => "◷  CHẬM",
        HealthBand.Stalled => "!  TREO",
        HealthBand.Recovering => "↻  ĐANG KHÔI PHỤC",
        HealthBand.Blocked => "!  BỊ CHẶN",
        _ => "•  CHƯA RÕ"
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
            WorkerUiState.Ready => Color.FromArgb(220, 252, 231),
            WorkerUiState.Working => Color.FromArgb(255, 237, 213),
            WorkerUiState.Paused => Color.FromArgb(241, 245, 249),
            _ => Color.FromArgb(254, 226, 226)
        };
        stateChip.ForeColor = view.State switch
        {
            WorkerUiState.Ready => Green,
            WorkerUiState.Working => Amber,
            WorkerUiState.Paused => Color.FromArgb(71, 85, 105),
            _ => Red
        };
        healthChip.Text = HealthText(watchdog?.Health);
        healthChip.BackColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Color.FromArgb(220, 252, 231),
            HealthBand.Slow => Color.FromArgb(255, 237, 213),
            HealthBand.Stalled => Color.FromArgb(254, 226, 226),
            HealthBand.Recovering => Color.FromArgb(219, 234, 254),
            _ => Color.FromArgb(241, 245, 249)
        };
        healthChip.ForeColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Green,
            HealthBand.Slow => Amber,
            HealthBand.Recovering => AccentDark,
            HealthBand.Stalled or HealthBand.Blocked => Red,
            _ => Muted
        };

        var noProgress = watchdog?.NoProgressFor.ToString(@"mm\:ss") ?? "—";
        var alive = watchdog is null || watchdog.AliveAge == TimeSpan.MaxValue ? "—" : watchdog.AliveAge.ToString(@"mm\:ss");
        var recovery = watchdog?.LastRecoveryAt?.ToLocalTime().ToString("HH:mm:ss") ?? "—";
        reason.Text = $"{view.Reason}  •  im lặng {noProgress}  •  heartbeat {alive}  •  khôi phục {recovery}";

        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        job.Text = $"JOB  {view.JobId ?? "—"}     {elapsed.ToString(@"hh\:mm\:ss")}";
        progress.Text = view.State == WorkerUiState.Working
            ? "Đang chạy — chờ bằng chứng tiến triển riêng; heartbeat chỉ xác nhận phiên còn hoạt động."
            : "Không có job đang chạy cần xác minh.";
        progress.ForeColor = view.State == WorkerUiState.Working ? Amber : Muted;

        schedule.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next
            ? $"Lần kiểm tra kế  ·  {next.ToLocalTime():HH:mm:ss  dd/MM}"
            : "Lịch kiểm tra  ·  Chưa đặt";
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
        TextChanged += (_, _) => BeginInvoke(new Action(RefreshRegion));
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