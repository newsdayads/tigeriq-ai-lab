using System.Drawing.Drawing2D;

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
        Size = new Size(48, 26);
        MinimumSize = Size;
        MaximumSize = Size;
        Text = $"TigerIQ {worker.Id}";
        BackColor = Color.FromArgb(15, 23, 42);

        label = new Label
        {
            Dock = DockStyle.Fill,
            Text = worker.Id[2..],
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 8, FontStyle.Bold),
            Cursor = Cursors.Hand,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.White,
            AccessibleName = $"Mở {worker.Id} {worker.Name}",
            AccessibleDescription = "Badge nhận diện gọn. Bấm để mở bảng điều khiển."
        };
        Controls.Add(label);
        SizeChanged += (_, _) => ApplyRoundedRegion();
        Shown += (_, _) => ApplyRoundedRegion();

        label.MouseDown += BeginPointer;
        label.MouseMove += MovePointer;
        label.MouseUp += EndPointer;
        MouseDown += BeginPointer;
        MouseMove += MovePointer;
        MouseUp += EndPointer;

        var menu = new ContextMenuStrip
        {
            Font = new Font("Segoe UI", 9),
            ShowImageMargin = false
        };
        menu.Items.Add("Mở bảng điều khiển", null, (_, _) => onClick(worker.Id));
        menu.Items.Add("Đặt lại badge", null, (_, _) => onReset(worker.Id));
        ContextMenuStrip = menu;
        label.ContextMenuStrip = menu;
    }

    void ApplyRoundedRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), Height / 2);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
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
        if (!dragging || lastChromeBounds == Rectangle.Empty) return;
        var cursor = Cursor.Position;
        var dx = cursor.X - dragCursorStart.X;
        var dy = cursor.Y - dragCursorStart.Y;
        if (Math.Abs(dx) + Math.Abs(dy) >= 3) moved = true;

        var desired = new Point(dragWindowStart.X + dx, dragWindowStart.Y + dy);
        var working = Screen.FromRectangle(lastChromeBounds).WorkingArea;
        var offsetX = desired.X - lastChromeBounds.Left;
        var offsetY = desired.Y - lastChromeBounds.Top;
        if (UiPlacement.TryBadge(lastChromeBounds, Size, working, offsetX, offsetY, out var target))
            Location = target;
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
        var shortId = worker.Id.StartsWith("NV", StringComparison.OrdinalIgnoreCase) ? worker.Id[2..] : worker.Id;
        label.Text = shortId;
        var back = CurrentState switch
        {
            WorkerUiState.Ready => Color.FromArgb(5, 150, 105),
            WorkerUiState.Working => Color.FromArgb(217, 119, 6),
            WorkerUiState.Paused => Color.FromArgb(71, 85, 105),
            _ => Color.FromArgb(220, 38, 38)
        };
        BackColor = back;
        label.BackColor = back;
        label.ForeColor = Color.White;
        label.AccessibleDescription = view is null
            ? "Không có trạng thái"
            : $"{CurrentState}: {view.Reason}. Bấm để mở bảng điều khiển.";
        Text = $"TigerIQ {worker.Id} — {CurrentState}";
    }

    public void AnchorTo(Rectangle chromeBounds, WorkerSettings settings)
    {
        lastChromeBounds = chromeBounds;
        if (dragging) return;
        var working = Screen.FromRectangle(chromeBounds).WorkingArea;
        if (!UiPlacement.TryBadge(chromeBounds, Size, working, settings.BadgeOffsetX, settings.BadgeOffsetY, out var target))
        {
            ApplyState(null);
            if (Visible) Hide();
            return;
        }
        if (Location != target) Location = target;
        if (!Visible) Show();
    }

    public void HideForPopup()
    {
        if (Visible) Hide();
    }

    public void MarkUnbound()
    {
        ApplyState(null);
        lastChromeBounds = Rectangle.Empty;
        if (Visible) Hide();
    }
}
