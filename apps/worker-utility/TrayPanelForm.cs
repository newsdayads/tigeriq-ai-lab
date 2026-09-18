using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class TrayPanelForm : Form
{
    static readonly Color Canvas = Color.FromArgb(5, 13, 25);
    static readonly Color Rail = Color.FromArgb(8, 19, 34);
    static readonly Color Card = Color.FromArgb(10, 24, 42);
    static readonly Color Ink = Color.FromArgb(241, 245, 249);
    static readonly Color Muted = Color.FromArgb(148, 163, 184);
    static readonly Color Border = Color.FromArgb(34, 55, 79);
    static readonly Color Green = Color.FromArgb(52, 211, 153);
    static readonly Color Amber = Color.FromArgb(251, 191, 36);
    static readonly Color Red = Color.FromArgb(248, 113, 113);

    readonly Dictionary<string, RoundedPanel> workerCards = new();
    readonly Dictionary<string, Label> stateLabels = new();
    readonly Dictionary<string, Label> jobLabels = new();
    readonly Dictionary<string, Label> noticeLabels = new();
    readonly Dictionary<string, Label> railStateLabels = new();
    readonly Dictionary<string, Button> primaryButtons = new();

    readonly Func<string, string, Task> workerAction;
    readonly Func<Task> focusAllChrome;
    readonly Action toggleDnd;
    readonly Action exit;
    readonly Label dndLabel = new()
    {
        AutoSize = true,
        ForeColor = Muted,
        Font = new Font("Segoe UI", 8.5f)
    };

    string? focusedWorker;

    protected override bool ShowWithoutActivation => false;

    public TrayPanelForm(Func<string, string, Task> workerAction, Func<Task> focusAllChrome, Action toggleDnd, Action exit)
    {
        this.workerAction = workerAction;
        this.focusAllChrome = focusAllChrome;
        this.toggleDnd = toggleDnd;
        this.exit = exit;

        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(1160, 540);
        MinimumSize = Size;
        MaximumSize = Size;
        BackColor = Canvas;
        Text = "TigerIQ Workers";

        Controls.Add(BuildRail());
        var x = 204;
        foreach (var worker in Workers.All)
        {
            var card = BuildWorkerCard(worker);
            card.Location = new Point(x, 14);
            Controls.Add(card);
            workerCards[worker.Id] = card;
            x += 316;
        }

        Shown += (_, _) => ApplyRoundedRegion();
        SizeChanged += (_, _) => ApplyRoundedRegion();
        Deactivate += (_, _) => Hide();
        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Escape)
            {
                Hide();
                e.SuppressKeyPress = true;
            }
        };
        KeyPreview = true;
    }

    Control BuildRail()
    {
        var rail = new RoundedPanel
        {
            Location = new Point(10, 14),
            Size = new Size(182, 512),
            BackColor = Rail,
            BorderColor = Border,
            BorderWidth = 1,
            CornerRadius = 15
        };

        var brand = new Label
        {
            Text = "🐯  TigerIQ Workers",
            AutoSize = true,
            Location = new Point(14, 15),
            ForeColor = Ink,
            Font = new Font("Segoe UI", 12.5f, FontStyle.Bold)
        };
        var sub = new Label
        {
            Text = "System Tray Utility",
            AutoSize = true,
            Location = new Point(16, 43),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 8.2f)
        };
        rail.Controls.Add(brand);
        rail.Controls.Add(sub);

        var y = 82;
        foreach (var worker in Workers.All)
        {
            var id = worker.Id;
            var button = RailButton($"{WorkerGlyph(id)}  {id} · {worker.Name}", y);
            button.Click += (_, _) => FocusWorker(id);
            rail.Controls.Add(button);

            var state = new Label
            {
                AutoSize = true,
                Location = new Point(32, y + 32),
                ForeColor = Muted,
                Font = new Font("Segoe UI", 7.7f),
                Text = "● đang tải…"
            };
            railStateLabels[id] = state;
            rail.Controls.Add(state);
            y += 58;
        }

        var sep = new Panel
        {
            Location = new Point(14, 260),
            Size = new Size(154, 1),
            BackColor = Border
        };
        rail.Controls.Add(sep);

        var quick = RailButton("▦  Bảng điều khiển nhanh", 278);
        quick.BackColor = Color.FromArgb(14, 52, 88);
        quick.ForeColor = Color.White;
        rail.Controls.Add(quick);

        var all = RailButton("⊞  Mở / Focus 3 Chrome", 318);
        all.Click += async (_, _) =>
        {
            try { await focusAllChrome(); }
            catch { }
        };
        rail.Controls.Add(all);

        var dnd = RailButton("◐  Không làm phiền", 358);
        dnd.Click += (_, _) => toggleDnd();
        rail.Controls.Add(dnd);

        dndLabel.Location = new Point(17, 398);
        rail.Controls.Add(dndLabel);

        var note = new Label
        {
            Text = "Click ngoài popup để tự ẩn.",
            AutoSize = true,
            Location = new Point(17, 430),
            ForeColor = Color.FromArgb(100, 116, 139),
            Font = new Font("Segoe UI", 7.7f)
        };
        rail.Controls.Add(note);

        var quit = RailButton("⏻  Thoát Utility", 462);
        quit.BackColor = Color.FromArgb(74, 24, 31);
        quit.ForeColor = Color.FromArgb(254, 202, 202);
        quit.Click += (_, _) => exit();
        rail.Controls.Add(quit);

        return rail;
    }

    RoundedPanel BuildWorkerCard(WorkerDefinition worker)
    {
        var accent = WorkerAccent(worker.Id);
        var card = new RoundedPanel
        {
            Size = new Size(304, 512),
            BackColor = Card,
            BorderColor = accent,
            BorderWidth = 2,
            CornerRadius = 15
        };

        var accentLine = new Panel { Location = new Point(0, 0), Size = new Size(304, 4), BackColor = accent };
        var glyph = new Label
        {
            Text = WorkerGlyph(worker.Id),
            Location = new Point(14, 15),
            Size = new Size(34, 34),
            TextAlign = ContentAlignment.MiddleCenter,
            BackColor = accent,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 11, FontStyle.Bold)
        };
        var name = new Label
        {
            Text = $"{worker.Id} · {worker.Name}",
            AutoSize = false,
            Location = new Point(58, 13),
            Size = new Size(185, 22),
            ForeColor = Ink,
            Font = new Font("Segoe UI", 11.5f, FontStyle.Bold),
            AutoEllipsis = true
        };
        var role = new Label
        {
            Text = "Cửa sổ Chrome thật",
            AutoSize = true,
            Location = new Point(59, 37),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 7.9f)
        };
        var online = new Label
        {
            Text = "● ONLINE",
            AutoSize = true,
            Location = new Point(232, 18),
            ForeColor = Green,
            Font = new Font("Segoe UI", 7.4f, FontStyle.Bold)
        };
        card.Controls.Add(accentLine);
        card.Controls.Add(glyph);
        card.Controls.Add(name);
        card.Controls.Add(role);
        card.Controls.Add(online);

        var section = new Label
        {
            Text = "TRẠNG THÁI",
            AutoSize = true,
            Location = new Point(14, 68),
            ForeColor = Color.FromArgb(100, 116, 139),
            Font = new Font("Segoe UI", 7.6f, FontStyle.Bold)
        };
        card.Controls.Add(section);

        var state = new Label
        {
            Text = "● ĐANG TẢI",
            AutoSize = false,
            Location = new Point(14, 88),
            Size = new Size(276, 22),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 9, FontStyle.Bold)
        };
        stateLabels[worker.Id] = state;
        card.Controls.Add(state);

        var job = new Label
        {
            Text = "Job hiện tại  —",
            AutoSize = false,
            Location = new Point(14, 112),
            Size = new Size(276, 34),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 8.2f)
        };
        jobLabels[worker.Id] = job;
        card.Controls.Add(job);

        var controlsLabel = new Label
        {
            Text = "VẬN HÀNH CỐT LÕI",
            AutoSize = true,
            Location = new Point(14, 156),
            ForeColor = Color.FromArgb(100, 116, 139),
            Font = new Font("Segoe UI", 7.6f, FontStyle.Bold)
        };
        card.Controls.Add(controlsLabel);

        AddCoreButton(card, worker.Id, "▶ Chạy / Tiếp tục", "run", 14, 178, accent);
        AddCoreButton(card, worker.Id, "Ⅱ Tạm dừng", "pause", 154, 178, Color.FromArgb(72, 48, 18));
        AddCoreButton(card, worker.Id, "⌖ Về vị trí", "fix", 14, 218, Color.FromArgb(24, 45, 70));
        AddCoreButton(card, worker.Id, "⌁ Khóa vị trí", "lock", 154, 218, Color.FromArgb(24, 45, 70));
        AddCoreButton(card, worker.Id, "↗ Mở trang", "open", 14, 258, Color.FromArgb(24, 45, 70));
        AddCoreButton(card, worker.Id, "⌕ Kiểm tra", "health", 154, 258, Color.FromArgb(24, 45, 70));
        AddCoreButton(card, worker.Id, "▣ Lưu", "save", 14, 298, Color.FromArgb(19, 47, 78));

        var hide = CoreButton("× Đóng an toàn", 136, 34, Color.FromArgb(25, 40, 60));
        hide.Location = new Point(154, 298);
        hide.AccessibleDescription = "Chỉ ẩn System Tray popup, không đóng Chrome.";
        hide.Click += (_, _) => Hide();
        card.Controls.Add(hide);

        var advanced = CoreButton("⚙ Nâng cao", 276, 36, Color.FromArgb(18, 38, 63));
        advanced.Location = new Point(14, 350);
        advanced.Click += (_, _) => ShowAdvancedMenu(worker.Id, advanced);
        card.Controls.Add(advanced);

        var notice = new Label
        {
            Text = "Sẵn sàng.",
            AutoSize = false,
            Location = new Point(14, 400),
            Size = new Size(276, 58),
            ForeColor = Muted,
            Font = new Font("Segoe UI", 8.1f),
            AutoEllipsis = true
        };
        noticeLabels[worker.Id] = notice;
        card.Controls.Add(notice);

        var hint = new Label
        {
            Text = "Focus / Khôi phục / Đóng NV / Lưu & Lưu trữ / Lịch nằm trong Nâng cao.",
            AutoSize = false,
            Location = new Point(14, 468),
            Size = new Size(276, 34),
            ForeColor = Color.FromArgb(100, 116, 139),
            Font = new Font("Segoe UI", 7.3f)
        };
        card.Controls.Add(hint);

        return card;
    }

    void AddCoreButton(Control parent, string workerId, string text, string actionName, int x, int y, Color back)
    {
        var button = CoreButton(text, 136, 34, back);
        button.Location = new Point(x, y);
        button.Tag = $"{workerId}|{actionName}";
        button.Click += async (_, _) => await InvokeWorkerActionAsync(workerId, actionName, button);
        parent.Controls.Add(button);
        primaryButtons[$"{workerId}:{actionName}"] = button;
    }

    Button CoreButton(string text, int width, int height, Color back)
    {
        var button = new Button
        {
            Text = text,
            Size = new Size(width, height),
            FlatStyle = FlatStyle.Flat,
            BackColor = back,
            ForeColor = Ink,
            Font = new Font("Segoe UI", 8.1f, FontStyle.Bold),
            Cursor = Cursors.Hand,
            TabStop = false
        };
        button.FlatAppearance.BorderColor = Border;
        button.FlatAppearance.BorderSize = 1;
        return button;
    }

    Button RailButton(string text, int y)
    {
        var button = new Button
        {
            Text = text,
            Location = new Point(12, y),
            Size = new Size(158, 34),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(13, 29, 49),
            ForeColor = Ink,
            Font = new Font("Segoe UI", 8.2f, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft,
            Cursor = Cursors.Hand,
            TabStop = false
        };
        button.FlatAppearance.BorderColor = Border;
        button.FlatAppearance.BorderSize = 1;
        return button;
    }

    async Task InvokeWorkerActionAsync(string workerId, string actionName, Control source)
    {
        source.Enabled = false;
        SetWorkerNotice(workerId, "Đang thực hiện…", false);
        try
        {
            await workerAction(workerId, actionName);
            if (noticeLabels[workerId].Text == "Đang thực hiện…")
                SetWorkerNotice(workerId, "✓ Hoàn tất", false);
        }
        catch (Exception ex)
        {
            SetWorkerNotice(workerId, FriendlyError(ex), true);
        }
        finally
        {
            source.Enabled = true;
        }
    }

    void ShowAdvancedMenu(string workerId, Control anchor)
    {
        var menu = new ContextMenuStrip
        {
            Font = new Font("Segoe UI", 9),
            BackColor = Color.FromArgb(8, 19, 34),
            ForeColor = Ink,
            ShowImageMargin = false
        };

        AddAdvanced(menu, workerId, "◎  Focus", "focus");
        AddAdvanced(menu, workerId, "↻  Khôi phục an toàn", "recover");
        AddAdvanced(menu, workerId, "⏻  Đóng NV an toàn", "close");
        menu.Items.Add(new ToolStripSeparator());
        AddAdvanced(menu, workerId, "▦  Lưu & Lưu trữ", "save-archive");
        AddAdvanced(menu, workerId, "↺  Đặt lại badge", "badge-reset");
        menu.Items.Add(new ToolStripSeparator());
        AddAdvanced(menu, workerId, "◷  Lịch 10 phút", "schedule-10");
        AddAdvanced(menu, workerId, "◷  Lịch 30 phút", "schedule-30");
        AddAdvanced(menu, workerId, "◷  Lịch 1 giờ", "schedule-60");
        AddAdvanced(menu, workerId, "◷  Lịch 2 giờ", "schedule-120");
        AddAdvanced(menu, workerId, "◷  Lịch tùy chỉnh", "schedule-custom");
        AddAdvanced(menu, workerId, "×  Tắt lịch", "schedule-cancel");

        menu.Closed += (_, _) => menu.Dispose();
        menu.Show(anchor, new Point(0, anchor.Height + 2));
    }

    void AddAdvanced(ContextMenuStrip menu, string workerId, string text, string actionName)
    {
        var item = new ToolStripMenuItem(text);
        item.Click += async (_, _) =>
        {
            SetWorkerNotice(workerId, "Đang thực hiện…", false);
            try
            {
                await workerAction(workerId, actionName);
                if (noticeLabels[workerId].Text == "Đang thực hiện…")
                    SetWorkerNotice(workerId, "✓ Hoàn tất", false);
            }
            catch (Exception ex)
            {
                SetWorkerNotice(workerId, FriendlyError(ex), true);
            }
        };
        menu.Items.Add(item);
    }

    static string FriendlyError(Exception ex)
    {
        var text = ex.Message.Replace("\r", " ").Replace("\n", " ").Trim();
        if (text.Contains("CONTROLLER_TIMEOUT", StringComparison.OrdinalIgnoreCase)
            || text.Contains("HttpClient.Timeout", StringComparison.OrdinalIgnoreCase))
            return "⚠ Controller phản hồi chậm. Thử lại.";
        return text.Length > 80 ? "⚠ " + text[..77] + "…" : "⚠ " + text;
    }

    public void SetWorkerNotice(string workerId, string message, bool error)
    {
        if (!noticeLabels.TryGetValue(workerId, out var label)) return;
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => SetWorkerNotice(workerId, message, error)));
            return;
        }
        label.ForeColor = error ? Red : (message.StartsWith("✓") ? Green : Muted);
        label.Text = message;
    }

    public void ApplyStates(IReadOnlyDictionary<string, WorkerView> views, UtilitySettings settings)
    {
        dndLabel.Text = settings.DoNotDisturb ? "Thông báo: đang tắt" : "Thông báo: đang bật";

        foreach (var worker in Workers.All)
        {
            if (!views.TryGetValue(worker.Id, out var view))
            {
                stateLabels[worker.Id].Text = "● CHƯA CÓ DỮ LIỆU";
                stateLabels[worker.Id].ForeColor = Red;
                jobLabels[worker.Id].Text = "Job hiện tại  —";
                railStateLabels[worker.Id].Text = "● chưa có dữ liệu";
                railStateLabels[worker.Id].ForeColor = Red;
                continue;
            }

            var stateText = view.State switch
            {
                WorkerUiState.Ready => "● SẴN SÀNG",
                WorkerUiState.Working => "● ĐANG CHẠY",
                WorkerUiState.Paused => "● TẠM DỪNG",
                _ => "● BỊ CHẶN"
            };
            var color = view.State switch
            {
                WorkerUiState.Ready or WorkerUiState.Working => Green,
                WorkerUiState.Paused => Amber,
                _ => Red
            };
            stateLabels[worker.Id].Text = stateText;
            stateLabels[worker.Id].ForeColor = color;
            jobLabels[worker.Id].Text = $"Job hiện tại  {view.JobId ?? "—"}\n{view.Reason}";
            railStateLabels[worker.Id].Text = view.State switch
            {
                WorkerUiState.Ready => "● sẵn sàng",
                WorkerUiState.Working => "● đang chạy",
                WorkerUiState.Paused => "● tạm dừng",
                _ => "● bị chặn"
            };
            railStateLabels[worker.Id].ForeColor = color;

            if (primaryButtons.TryGetValue($"{worker.Id}:lock", out var lockButton))
                lockButton.Text = settings.Workers[worker.Id].PositionLocked ? "⌁ Mở khóa vị trí" : "⌁ Khóa vị trí";
        }
    }

    public void FocusWorker(string workerId)
    {
        focusedWorker = workerId;
        foreach (var pair in workerCards)
        {
            var accent = WorkerAccent(pair.Key);
            pair.Value.BorderColor = accent;
            pair.Value.BorderWidth = pair.Key == workerId ? 3 : 2;
            pair.Value.Invalidate();
        }
    }

    public void ToggleNearTray(string? focusWorker = null)
    {
        if (Visible)
        {
            if (focusWorker is null || string.Equals(focusedWorker, focusWorker, StringComparison.OrdinalIgnoreCase))
            {
                Hide();
                return;
            }
            FocusWorker(focusWorker);
            Activate();
            return;
        }

        var cursorScreen = Screen.FromPoint(Cursor.Position);
        var work = cursorScreen.WorkingArea;
        Location = new Point(work.Right - Width - 12, work.Bottom - Height - 12);
        if (focusWorker is not null) FocusWorker(focusWorker);
        Show();
        Activate();
    }

    static Color WorkerAccent(string id) => id switch
    {
        "NV02" => Color.FromArgb(37, 99, 235),
        "NV03" => Color.FromArgb(192, 64, 255),
        "NV04" => Color.FromArgb(6, 182, 212),
        _ => Color.FromArgb(59, 130, 246)
    };

    static string WorkerGlyph(string id) => id switch
    {
        "NV02" => "02",
        "NV03" => "03",
        "NV04" => "04",
        _ => "NV"
    };

    void ApplyRoundedRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = PopupForm.RoundedPath(new Rectangle(0, 0, Width, Height), 18);
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }
}
