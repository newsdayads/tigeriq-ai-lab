using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class BadgeForm : Form
{
    readonly WorkerDefinition worker;
    readonly Action<string> onClick;
    readonly Action<string, Point> onMoved;
    readonly Action<string> onReset;
    readonly Label label;
    readonly Label statusDot;
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
        var accent = WorkerAccent(worker.Id);
        BackColor = accent;

        label = new Label
        {
            Dock = DockStyle.Fill,
            Text = worker.Id[2..],
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 8, FontStyle.Bold),
            Cursor = Cursors.Hand,
            BackColor = accent,
            ForeColor = Color.White,
            AccessibleName = $"Mở {worker.Id} {worker.Name}",
            AccessibleDescription = "Badge nhận diện cố định theo NV. Bấm để mở hoặc ẩn bảng điều khiển."
        };
        statusDot = new Label
        {
            AutoSize = false,
            Text = "●",
            Size = new Size(12, 12),
            Location = new Point(34, 7),
            BackColor = Color.Transparent,
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 6.5f, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleCenter,
            Cursor = Cursors.Hand
        };
        Controls.Add(label);
        Controls.Add(statusDot);
        statusDot.BringToFront();
        SizeChanged += (_, _) => ApplyRoundedRegion();
        Shown += (_, _) => ApplyRoundedRegion();

        label.MouseDown += BeginPointer;
        label.MouseMove += MovePointer;
        label.MouseUp += EndPointer;
        statusDot.MouseDown += BeginPointer;
        statusDot.MouseMove += MovePointer;
        statusDot.MouseUp += EndPointer;
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
        var accent = WorkerAccent(worker.Id);
        BackColor = accent;
        label.BackColor = accent;
        label.ForeColor = Color.White;
        statusDot.ForeColor = CurrentState switch
        {
            WorkerUiState.Ready => Color.FromArgb(52, 211, 153),
            WorkerUiState.Working => Color.FromArgb(52, 211, 153),
            WorkerUiState.Paused => Color.FromArgb(251, 191, 36),
            _ => Color.FromArgb(248, 113, 113)
        };
        label.AccessibleDescription = view is null
            ? "Không có trạng thái"
            : $"{CurrentState}: {view.Reason}. Bấm để mở hoặc ẩn bảng điều khiển.";
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

    static Color WorkerAccent(string id) => id switch
    {
        "NV02" => Color.FromArgb(37, 99, 235),
        "NV03" => Color.FromArgb(168, 85, 247),
        "NV04" => Color.FromArgb(6, 182, 212),
        _ => Color.FromArgb(59, 130, 246)
    };

    public void MarkUnbound()
    {
        ApplyState(null);
        lastChromeBounds = Rectangle.Empty;
        if (Visible) Hide();
    }
}
