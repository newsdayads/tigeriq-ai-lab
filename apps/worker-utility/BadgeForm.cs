namespace TigerIQ.WorkerUtility;

internal sealed class BadgeForm : Form
{
    readonly WorkerDefinition worker;
    readonly Action<string> onClick;
    readonly Action<string, Point> onMoved;
    readonly Action<string> onReset;
    readonly Label label;
    Rectangle lastChromeBounds;
    Point dragCursorStart;
    Point dragWindowStart;
    bool dragging;
    bool moved;

    public WorkerUiState CurrentState { get; private set; } = WorkerUiState.Blocked;
    protected override bool ShowWithoutActivation => true;

    public BadgeForm(WorkerDefinition worker, Action<string> onClick, Action<string, Point> onMoved, Action<string> onReset)
    {
        this.worker = worker;
        this.onClick = onClick;
        this.onMoved = onMoved;
        this.onReset = onReset;

        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(64, 30);
        MinimumSize = Size;
        MaximumSize = Size;
        Text = $"TigerIQ {worker.Id}";
        BackColor = Color.White;

        label = new Label
        {
            Dock = DockStyle.Fill,
            Text = worker.Id,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            BorderStyle = BorderStyle.FixedSingle,
            Cursor = Cursors.SizeAll,
            Padding = new Padding(4, 0, 4, 0),
            AccessibleName = $"Điều khiển {worker.Id} {worker.Name}",
            AccessibleDescription = "Bấm để mở bảng điều khiển; kéo để đổi vị trí; chuột phải để đặt lại vị trí."
        };
        Controls.Add(label);

        label.MouseDown += BeginPointer;
        label.MouseMove += MovePointer;
        label.MouseUp += EndPointer;
        MouseDown += BeginPointer;
        MouseMove += MovePointer;
        MouseUp += EndPointer;

        var menu = new ContextMenuStrip();
        menu.Items.Add("Mở bảng điều khiển", null, (_, _) => onClick(worker.Id));
        menu.Items.Add("Đặt lại vị trí badge", null, (_, _) => onReset(worker.Id));
        ContextMenuStrip = menu;
        label.ContextMenuStrip = menu;
    }

    void BeginPointer(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        dragging = true;
        moved = false;
        dragCursorStart = Cursor.Position;
        dragWindowStart = Location;
        Capture = true;
    }

    void MovePointer(object? sender, MouseEventArgs e)
    {
        if (!dragging) return;
        var cursor = Cursor.Position;
        var dx = cursor.X - dragCursorStart.X;
        var dy = cursor.Y - dragCursorStart.Y;
        if (Math.Abs(dx) + Math.Abs(dy) >= 3) moved = true;
        var screen = Screen.FromPoint(cursor).WorkingArea;
        Location = UiPlacement.Clamp(new Point(dragWindowStart.X + dx, dragWindowStart.Y + dy), Size, screen);
    }

    void EndPointer(object? sender, MouseEventArgs e)
    {
        if (!dragging || e.Button != MouseButtons.Left) return;
        dragging = false;
        Capture = false;
        if (!moved)
        {
            onClick(worker.Id);
            return;
        }
        if (lastChromeBounds != Rectangle.Empty)
            onMoved(worker.Id, new Point(Location.X - lastChromeBounds.Left, Location.Y - lastChromeBounds.Top));
    }

    public void ApplyState(WorkerView? view)
    {
        CurrentState = view?.State ?? WorkerUiState.Blocked;
        var glyph = CurrentState switch
        {
            WorkerUiState.Ready => "●",
            WorkerUiState.Working => "▶",
            WorkerUiState.Paused => "Ⅱ",
            _ => "!"
        };
        label.Text = $"{worker.Id[2..]}  {glyph}";
        label.BackColor = CurrentState switch
        {
            WorkerUiState.Ready => Color.FromArgb(226, 248, 236),
            WorkerUiState.Working => Color.FromArgb(255, 244, 219),
            WorkerUiState.Paused => Color.FromArgb(237, 240, 244),
            _ => Color.FromArgb(255, 236, 236)
        };
        label.ForeColor = CurrentState switch
        {
            WorkerUiState.Ready => Color.FromArgb(23, 111, 67),
            WorkerUiState.Working => Color.FromArgb(151, 93, 0),
            WorkerUiState.Paused => Color.FromArgb(79, 88, 99),
            _ => Color.FromArgb(176, 42, 42)
        };
        label.AccessibleDescription = view is null
            ? "Không có trạng thái"
            : $"{CurrentState}: {view.Reason}. Bấm mở bảng điều khiển, kéo để đổi vị trí.";
        Text = $"TigerIQ {worker.Id} — {CurrentState}";
    }

    public void AnchorTo(Rectangle chromeBounds, WorkerSettings settings)
    {
        lastChromeBounds = chromeBounds;
        if (dragging) return;
        var working = Screen.FromRectangle(chromeBounds).WorkingArea;
        var target = settings.BadgeOffsetX is int x && settings.BadgeOffsetY is int y
            ? UiPlacement.BadgeFromOffset(chromeBounds, Size, working, x, y)
            : UiPlacement.DefaultBadge(chromeBounds, Size, working);
        if (Location != target) Location = target;
        if (!Visible) Show();
    }

    public void MarkUnbound()
    {
        ApplyState(null);
        lastChromeBounds = Rectangle.Empty;
        if (Visible) Hide();
    }
}
