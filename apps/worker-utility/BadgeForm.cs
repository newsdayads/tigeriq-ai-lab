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
        Size = new Size(52, 26);
        MinimumSize = Size;
        MaximumSize = Size;
        Text = $"TigerIQ {worker.Id}";

        label = new Label
        {
            Dock = DockStyle.Fill,
            Text = worker.Id[2..],
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            BorderStyle = BorderStyle.FixedSingle,
            Cursor = Cursors.SizeAll,
            AccessibleName = $"Điều khiển {worker.Id} {worker.Name}",
            AccessibleDescription = "Bấm để mở điều khiển; kéo để đổi vị trí; chuột phải để đặt lại vị trí."
        };
        Controls.Add(label);

        label.MouseDown += BeginPointer;
        label.MouseMove += MovePointer;
        label.MouseUp += EndPointer;
        MouseDown += BeginPointer;
        MouseMove += MovePointer;
        MouseUp += EndPointer;

        var menu = new ContextMenuStrip();
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
            WorkerUiState.Ready => "✓",
            WorkerUiState.Working => "▶",
            WorkerUiState.Paused => "Ⅱ",
            _ => "!"
        };
        label.Text = $"{worker.Id[2..]} {glyph}";
        label.BackColor = CurrentState switch
        {
            WorkerUiState.Ready => Color.Honeydew,
            WorkerUiState.Working => Color.LightGoldenrodYellow,
            WorkerUiState.Paused => Color.Gainsboro,
            _ => Color.MistyRose
        };
        label.ForeColor = SystemColors.ControlText;
        label.AccessibleDescription = view is null
            ? "Không có trạng thái"
            : $"{CurrentState}: {view.Reason}. Bấm mở điều khiển, kéo để đổi vị trí.";
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
