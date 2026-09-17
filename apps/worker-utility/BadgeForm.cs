namespace TigerIQ.WorkerUtility;

internal sealed class BadgeForm : Form
{
    readonly WorkerDefinition worker;
    readonly Action<string> onClick;
    readonly Label label;
    public WorkerUiState CurrentState { get; private set; } = WorkerUiState.Blocked;

    public BadgeForm(WorkerDefinition worker, Action<string> onClick)
    {
        this.worker = worker;
        this.onClick = onClick;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(38, 26);
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
            Cursor = Cursors.Hand,
            AccessibleName = $"Mở điều khiển {worker.Id} {worker.Name}"
        };
        Controls.Add(label);
        label.Click += (_, _) => onClick(worker.Id);
        Click += (_, _) => onClick(worker.Id);
    }
    public void ApplyState(WorkerView? view)
    {
        CurrentState = view?.State ?? WorkerUiState.Blocked;
        label.Text = worker.Id[2..];
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
            : $"{CurrentState}: {view.Reason}";
        Text = $"TigerIQ {worker.Id} — {CurrentState}";
    }

    public void AnchorTo(Rectangle chromeBounds)
    {
        var x = chromeBounds.Right - Width - 8;
        var y = chromeBounds.Top + 5;
        if (Location.X != x || Location.Y != y) Location = new Point(x, y);
        if (!Visible) Show();
    }

    public void MarkUnbound()
    {
        ApplyState(null);
        if (Visible) Hide();
    }
}
