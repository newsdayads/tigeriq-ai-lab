using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class TrayPanelForm : Form
{
    static readonly Color Canvas = Color.FromArgb(5, 13, 25);
    static readonly Color Card = Color.FromArgb(12, 25, 43);
    static readonly Color Border = Color.FromArgb(33, 55, 79);
    static readonly Color Ink = Color.FromArgb(241, 245, 249);
    static readonly Color Muted = Color.FromArgb(148, 163, 184);
    static readonly Color Green = Color.FromArgb(52, 211, 153);
    static readonly Color Amber = Color.FromArgb(251, 191, 36);
    static readonly Color Red = Color.FromArgb(248, 113, 113);

    readonly Dictionary<string, Label> stateLabels = new();
    readonly Dictionary<string, Label> dotLabels = new();
    readonly Label dndLabel = new() { AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8.5f) };
    readonly Action<string> openWorker;
    readonly Action openAllChrome;
    readonly Action openQuick;
    readonly Action showSettings;
    readonly Action showLogs;
    readonly Action exit;

    protected override bool ShowWithoutActivation => false;

    public TrayPanelForm(Action<string> openWorker, Action openAllChrome, Action openQuick, Action showSettings, Action showLogs, Action exit)
    {
        this.openWorker = openWorker;
        this.openAllChrome = openAllChrome;
        this.openQuick = openQuick;
        this.showSettings = showSettings;
        this.showLogs = showLogs;
        this.exit = exit;

        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(286, 520);
        BackColor = Canvas;
        Padding = new Padding(10);
        Text = "TigerIQ Workers";

        var root = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            BackColor = Canvas,
            Padding = new Padding(4),
            AutoScroll = false
        };
        root.Controls.Add(BuildHeader());
        foreach (var worker in Workers.All) root.Controls.Add(BuildWorkerRow(worker));
        root.Controls.Add(BuildGlobalActions());
        Controls.Add(root);

        Shown += (_, _) => ApplyRoundedRegion();
        SizeChanged += (_, _) => ApplyRoundedRegion();
        Deactivate += (_, _) => Hide();
        KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape) Hide(); };
        KeyPreview = true;
    }

    Control BuildHeader()
    {
        var panel = new Panel
        {
            Size = new Size(250, 64),
            Margin = new Padding(0, 0, 0, 8),
            BackColor = Color.FromArgb(8, 19, 34)
        };
        var brand = new Label
        {
            Text = "🐯  TigerIQ Workers",
            AutoSize = true,
            Location = new Point(10, 8),
            ForeColor = Ink,
            Font = new Font("Segoe UI", 13, FontStyle.Bold)
        };
        var sub = new Label
        {
            Text = "Điều khiển 3 nhân viên Chrome",
            AutoSize = true,
            Location = new Point(12, 34),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 8.5f)
        };
        dndLabel.Location = new Point(12, 49);
        panel.Controls.Add(brand);
        panel.Controls.Add(sub);
        panel.Controls.Add(dndLabel);
        return panel;
    }

    Control BuildWorkerRow(WorkerDefinition worker)
    {
        var accent = WorkerAccent(worker.Id);
        var panel = new Panel
        {
            Size = new Size(250, 70),
            Margin = new Padding(0, 0, 0, 7),
            BackColor = Card
        };
        var stripe = new Panel { BackColor = accent, Location = new Point(0, 0), Size = new Size(4, 70) };
        var dot = new Label
        {
            Text = "●",
            AutoSize = true,
            Location = new Point(14, 12),
            Font = new Font("Segoe UI", 10, FontStyle.Bold),
            ForeColor = Red
        };
        var name = new Label
        {
            Text = $"{worker.Id} — {worker.Name}",
            AutoSize = true,
            Location = new Point(34, 10),
            ForeColor = Ink,
            Font = new Font("Segoe UI", 10, FontStyle.Bold)
        };
        var state = new Label
        {
            Text = "Đang tải trạng thái…",
            AutoSize = false,
            AutoEllipsis = true,
            Size = new Size(172, 34),
            Location = new Point(34, 33),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 7.8f)
        };
        var arrow = new Label
        {
            Text = "›",
            AutoSize = false,
            Size = new Size(28, 44),
            Location = new Point(210, 13),
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = accent,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Cursor = Cursors.Hand
        };

        void OpenSelected(object? _, EventArgs __)
        {
            Hide();
            openWorker(worker.Id);
        }

        panel.Cursor = Cursors.Hand;
        panel.Click += OpenSelected;
        stripe.Click += OpenSelected;
        dot.Click += OpenSelected;
        name.Click += OpenSelected;
        state.Click += OpenSelected;
        arrow.Click += OpenSelected;

        dotLabels[worker.Id] = dot;
        stateLabels[worker.Id] = state;
        panel.Controls.Add(stripe);
        panel.Controls.Add(dot);
        panel.Controls.Add(name);
        panel.Controls.Add(state);
        panel.Controls.Add(arrow);
        return panel;
    }

    Control BuildGlobalActions()
    {
        var panel = new Panel
        {
            Size = new Size(250, 190),
            Margin = new Padding(0, 3, 0, 0),
            BackColor = Canvas
        };

        var all = MakeButton("▦  Mở tất cả cửa sổ", new Point(0, 0), new Size(250, 34));
        all.Click += (_, _) => { Hide(); openAllChrome(); };

        var quick = MakeButton("▣  Bảng điều khiển nhanh", new Point(0, 40), new Size(250, 34));
        quick.Click += (_, _) => { Hide(); openQuick(); };

        var settings = MakeButton("⚙  Cài đặt", new Point(0, 80), new Size(250, 34));
        settings.Click += (_, _) => { Hide(); showSettings(); };

        var logs = MakeButton("▤  Xem log hệ thống", new Point(0, 120), new Size(250, 34));
        logs.Click += (_, _) => { Hide(); showLogs(); };

        var quit = MakeButton("⏻  Thoát", new Point(0, 160), new Size(250, 34));
        quit.BackColor = Color.FromArgb(74, 24, 31);
        quit.ForeColor = Color.FromArgb(254, 202, 202);
        quit.Click += (_, _) => exit();

        panel.Controls.Add(all);
        panel.Controls.Add(quick);
        panel.Controls.Add(settings);
        panel.Controls.Add(logs);
        panel.Controls.Add(quit);
        return panel;
    }

    Button MakeButton(string text, Point location, Size size)
    {
        var button = new Button
        {
            Text = text,
            Location = location,
            Size = size,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(20, 40, 64),
            ForeColor = Ink,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            Cursor = Cursors.Hand,
            TabStop = false
        };
        button.FlatAppearance.BorderColor = Border;
        button.FlatAppearance.BorderSize = 1;
        return button;
    }

    public void ApplyStates(IReadOnlyDictionary<string, WorkerView> views, IReadOnlyDictionary<string, HarnessView> harness, UtilitySettings settings)
    {
        dndLabel.Text = settings.DoNotDisturb ? "Thông báo: đang tắt" : "Thông báo: đang bật";
        foreach (var worker in Workers.All)
        {
            if (!views.TryGetValue(worker.Id, out var view))
            {
                dotLabels[worker.Id].ForeColor = Red;
                stateLabels[worker.Id].Text = "Chưa có dữ liệu" + HarnessSuffix(worker.Id, harness);
                continue;
            }

            dotLabels[worker.Id].ForeColor = view.State switch
            {
                WorkerUiState.Ready => Green,
                WorkerUiState.Working => Green,
                WorkerUiState.Paused => Amber,
                _ => Red
            };
            stateLabels[worker.Id].ForeColor = view.State == WorkerUiState.Blocked ? Red : Muted;
            var stateText = view.State switch
            {
                WorkerUiState.Ready => "● Sẵn sàng",
                WorkerUiState.Working => $"● Chạy · {view.JobId ?? "đang xử lý"}",
                WorkerUiState.Paused => "● Tạm dừng",
                _ => $"● Chặn · {view.Reason}"
            };
            harness.TryGetValue(worker.Id, out var harnessView);
            settings.Workers.TryGetValue(worker.Id, out var workerSettings);
            settings.Schedules.TryGetValue(worker.Id, out var scheduleSettings);
            var ownerView = WorkerObservability.Build(
                view,
                harnessView,
                workerSettings ?? new WorkerSettings(),
                scheduleSettings,
                Array.Empty<string>());
            stateLabels[worker.Id].Text =
                stateText + HarnessSuffix(worker.Id, harness)
                + Environment.NewLine
                + $"↪ {ownerView.Next} · {ownerView.LastActivity}";
        }
    }

    static string HarnessSuffix(string id, IReadOnlyDictionary<string, HarnessView> harness)
    {
        if (!harness.TryGetValue(id, out var value)) return "";
        var shortState = value.State switch
        {
            HarnessState.Ready => "OK",
            HarnessState.Busy => "BẬN",
            HarnessState.Blocked => "CHẶN",
            HarnessState.Missing => "THIẾU",
            HarnessState.Error => "LỖI",
            HarnessState.Unknown => "?",
            _ => "—"
        };
        return $" · BH:{shortState}";
    }

    public void ToggleNearTray()
    {
        if (Visible) { Hide(); return; }
        var cursorScreen = Screen.FromPoint(Cursor.Position);
        var work = cursorScreen.WorkingArea;
        Location = new Point(work.Right - Width - 12, work.Bottom - Height - 12);
        Show();
        Activate();
    }

    static Color WorkerAccent(string id) => id switch
    {
        "NV02" => Color.FromArgb(37, 99, 235),
        "NV03" => Color.FromArgb(168, 85, 247),
        "NV04" => Color.FromArgb(6, 182, 212),
        _ => Color.FromArgb(59, 130, 246)
    };

    void ApplyRoundedRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), 16);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }
}
