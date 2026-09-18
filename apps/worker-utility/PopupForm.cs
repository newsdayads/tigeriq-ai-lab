using System.Drawing.Drawing2D;

namespace TigerIQ.WorkerUtility;

internal sealed class PopupForm : Form
{
    static readonly Color Canvas = Color.FromArgb(5, 13, 25);
    static readonly Color Card = Color.FromArgb(10, 24, 42);
    static readonly Color CardAlt = Color.FromArgb(14, 32, 54);
    static readonly Color Ink = Color.FromArgb(241, 245, 249);
    static readonly Color Muted = Color.FromArgb(148, 163, 184);
    static readonly Color Border = Color.FromArgb(34, 55, 79);
    static readonly Color Green = Color.FromArgb(52, 211, 153);
    static readonly Color Amber = Color.FromArgb(251, 191, 36);
    static readonly Color Red = Color.FromArgb(248, 113, 113);

    const int HeaderTop = 10;
    const int HeaderHeight = 88;
    readonly Panel root = new() { Dock = DockStyle.Fill, BackColor = Canvas };
    readonly RoundedPanel headerCard;
    readonly RoundedPanel statusCard;
    readonly RoundedPanel controlsCard;
    readonly RoundedPanel saveCard;
    readonly RoundedPanel scheduleCard;
    readonly RoundedPanel logsCard;
    readonly Label workerGlyph = new()
    {
        AutoSize = false, Size = new Size(32, 32), TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Color.White
    };
    readonly Label eyebrow = new()
    {
        AutoSize = true, Text = "TIGERIQ / WORKER CONTROL",
        Font = new Font("Segoe UI", 7.8f, FontStyle.Bold), ForeColor = Muted
    };
    readonly Label workerName = new()
    {
        AutoSize = false, Size = new Size(150, 24),
        Font = new Font("Segoe UI", 12.5f, FontStyle.Bold), ForeColor = Ink
    };
    readonly Label subtitle = new()
    {
        AutoSize = true, Text = "Trung tâm điều khiển Chrome thật",
        Font = new Font("Segoe UI", 8.4f), ForeColor = Muted
    };
    readonly PillLabel onlineChip = NewPill();
    readonly PillLabel stateChip = NewPill();
    readonly PillLabel healthChip = NewPill();
    readonly Label job = new()
    {
        AutoSize = false, Size = new Size(292, 16), ForeColor = Ink,
        Font = new Font("Segoe UI", 8.5f, FontStyle.Bold)
    };
    readonly Label reason = new()
    {
        AutoSize = false, AutoEllipsis = true, Size = new Size(292, 16), ForeColor = Muted,
        Font = new Font("Segoe UI", 8.2f)
    };
    readonly Label actionStatus = new()
    {
        AutoSize = false, AutoEllipsis = true, Size = new Size(292, 16), ForeColor = Muted,
        Font = new Font("Segoe UI", 8.2f)
    };
    readonly Label scheduleText = new()
    {
        AutoSize = false, AutoEllipsis = true, Size = new Size(292, 17), ForeColor = Amber,
        Font = new Font("Segoe UI", 8.1f, FontStyle.Bold)
    };
    readonly Label logSummary = new()
    {
        AutoSize = false, Size = new Size(292, 42), ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Consolas", 7.7f), BackColor = Card
    };
    readonly CheckBox scheduleEnabled = NewCheckBox("Bật lịch");
    readonly CheckBox changeOnly = NewCheckBox("Chỉ báo thay đổi/lỗi");
    readonly Dictionary<string, RoundedButton> actionButtons = new();
    readonly Func<string, string, Task> action;
    readonly Action<string, Point> positionChanged;
    readonly ToolTip tips = new();
    readonly RoundedButton closeButton;
    readonly RoundedButton footerAdvanced;
    readonly RoundedButton footerHide;
    AdvancedInfoForm? advancedForm;
    string[] advancedLines = [];
    string workerId = "NV02";
    bool suppressScheduleEvents;
    bool suppressPositionEvent;

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
        ClientSize = new Size(344, 728);
        MinimumSize = Size;
        MaximumSize = Size;
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None;
        ShowIcon = false;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        BackColor = Canvas;
        AccessibleName = "TigerIQ Worker Utility";
        AccessibleDescription = "Bảng điều khiển worker theo layout TigerIQ.";

        headerCard = NewCard(new Rectangle(10, 10, 324, 88));
        statusCard = NewCard(new Rectangle(10, 106, 324, 100));
        controlsCard = NewCard(new Rectangle(10, 214, 324, 166));
        saveCard = NewCard(new Rectangle(10, 388, 324, 100));
        scheduleCard = NewCard(new Rectangle(10, 496, 324, 104));
        logsCard = NewCard(new Rectangle(10, 608, 324, 76));

        closeButton = MakeLocalButton("×", 28, 28);
        closeButton.Font = new Font("Segoe UI", 12, FontStyle.Bold);
        closeButton.Location = new Point(282, 10);
        closeButton.AccessibleName = "Ẩn bảng điều khiển";
        closeButton.Click += (_, _) => Hide();

        BuildHeader();
        BuildStatus();
        BuildControls();
        BuildSaveRecover();
        BuildSchedule();
        BuildLogs();

        footerAdvanced = MakeActionButton("⚙  Nâng cao", "advanced-toggle", 150, 30);
        footerAdvanced.Location = new Point(16, 690);
        footerHide = MakeLocalButton("×  Ẩn bảng", 150, 30);
        footerHide.Location = new Point(178, 690);
        footerHide.Click += (_, _) => Hide();

        root.Controls.Add(headerCard);
        root.Controls.Add(statusCard);
        root.Controls.Add(controlsCard);
        root.Controls.Add(saveCard);
        root.Controls.Add(scheduleCard);
        root.Controls.Add(logsCard);
        root.Controls.Add(footerAdvanced);
        root.Controls.Add(footerHide);
        Controls.Add(root);

        scheduleEnabled.CheckedChanged += async (_, _) =>
        {
            if (!suppressScheduleEvents) await InvokeActionAsync(scheduleEnabled.Checked ? "schedule-on" : "schedule-off");
        };
        changeOnly.CheckedChanged += async (_, _) =>
        {
            if (!suppressScheduleEvents) await InvokeActionAsync(changeOnly.Checked ? "schedule-change-only-on" : "schedule-change-only-off");
        };

        Shown += (_, _) => ApplyRoundedRegion(this, 18);
        SizeChanged += (_, _) => ApplyRoundedRegion(this, 18);
        VisibleChanged += (_, _) =>
        {
            if (!Visible && advancedForm?.Visible == true) advancedForm.Hide();
        };
        Move += (_, _) =>
        {
            if (Visible && !suppressPositionEvent) positionChanged(workerId, Location);
        };
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
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_NCHITTEST = 0x0084;
        const int HTCLIENT = 1;
        const int HTCAPTION = 2;
        base.WndProc(ref m);
        if (m.Msg != WM_NCHITTEST || m.Result != (IntPtr)HTCLIENT) return;
        var raw = m.LParam.ToInt64();
        var screenPoint = new Point(unchecked((short)(raw & 0xffff)), unchecked((short)((raw >> 16) & 0xffff)));
        var p = PointToClient(screenPoint);
        var closeScreen = new Rectangle(closeButton.PointToScreen(Point.Empty), closeButton.Size);
        if (p.Y >= HeaderTop && p.Y < HeaderTop + HeaderHeight && !closeScreen.Contains(screenPoint))
            m.Result = (IntPtr)HTCAPTION;
    }

    void BuildHeader()
    {
        var accent = new Panel { Location = new Point(0, 0), Size = new Size(324, 3) };
        eyebrow.Location = new Point(14, 10);
        workerGlyph.Location = new Point(14, 38);
        workerName.Location = new Point(54, 34);
        subtitle.Location = new Point(54, 59);
        onlineChip.Location = new Point(207, 39);

        headerCard.Controls.Add(accent);
        headerCard.Controls.Add(eyebrow);
        headerCard.Controls.Add(workerGlyph);
        headerCard.Controls.Add(workerName);
        headerCard.Controls.Add(subtitle);
        headerCard.Controls.Add(onlineChip);
        headerCard.Controls.Add(closeButton);
        accent.Tag = "accent";
    }

    void BuildStatus()
    {
        AddSectionTitle(statusCard, "TRẠNG THÁI PHIÊN");
        stateChip.Location = new Point(12, 28);
        healthChip.Location = new Point(124, 28);
        job.Location = new Point(12, 52);
        reason.Location = new Point(12, 69);
        actionStatus.Location = new Point(12, 84);
        statusCard.Controls.Add(stateChip);
        statusCard.Controls.Add(healthChip);
        statusCard.Controls.Add(job);
        statusCard.Controls.Add(reason);
        statusCard.Controls.Add(actionStatus);
    }

    void BuildControls()
    {
        AddSectionTitle(controlsCard, "ĐIỀU KHIỂN & CỬA SỔ");
        AddGridButton(controlsCard, "▶  Chạy / Tiếp tục", "run", 12, 30);
        AddGridButton(controlsCard, "Ⅱ  Tạm dừng", "pause", 164, 30);
        AddGridButton(controlsCard, "⌖  Về vị trí", "fix", 12, 64);
        AddGridButton(controlsCard, "⌁  Khóa vị trí", "lock", 164, 64);
        AddGridButton(controlsCard, "◎  Focus", "focus", 12, 98);
        AddGridButton(controlsCard, "↺  Đặt lại badge", "badge-reset", 164, 98);
        AddGridButton(controlsCard, "↗  Mở đúng trang", "open", 12, 132);
        AddGridButton(controlsCard, "⌕  Kiểm tra nhanh", "health", 164, 132);
    }

    void BuildSaveRecover()
    {
        AddSectionTitle(saveCard, "LƯU & PHỤC HỒI");
        AddGridButton(saveCard, "▣  Lưu", "save", 12, 28);
        AddGridButton(saveCard, "▦  Lưu & Lưu trữ", "save-archive", 164, 28);
        AddGridButton(saveCard, "⏻  Đóng NV an toàn", "close", 12, 62);
        AddGridButton(saveCard, "↻  Khôi phục", "recover", 164, 62);
    }

    void BuildSchedule()
    {
        AddSectionTitle(scheduleCard, "ĐẶT LỊCH KIỂM TRA");
        var entries = new[] {
            ("10p", "schedule-10", 42),
            ("30p", "schedule-30", 42),
            ("1h", "schedule-60", 42),
            ("2h", "schedule-120", 42),
            ("Tùy chỉnh", "schedule-custom", 92)
        };
        var x = 12;
        foreach (var item in entries)
        {
            var b = MakeActionButton(item.Item1, item.Item2, item.Item3, 27);
            b.Location = new Point(x, 29);
            scheduleCard.Controls.Add(b);
            x += item.Item3 + 4;
        }
        scheduleEnabled.Location = new Point(12, 60);
        changeOnly.Location = new Point(96, 60);
        scheduleText.Location = new Point(12, 81);
        scheduleCard.Controls.Add(scheduleEnabled);
        scheduleCard.Controls.Add(changeOnly);
        scheduleCard.Controls.Add(scheduleText);
    }

    void BuildLogs()
    {
        AddSectionTitle(logsCard, "LOG GẦN NHẤT");
        logSummary.Location = new Point(12, 27);
        logsCard.Controls.Add(logSummary);
    }

    void AddGridButton(Control parent, string text, string actionName, int x, int y)
    {
        var b = MakeActionButton(text, actionName, 144, 30);
        b.Location = new Point(x, y);
        parent.Controls.Add(b);
    }

    static void AddSectionTitle(Control parent, string title)
    {
        parent.Controls.Add(new Label
        {
            Text = title, AutoSize = true, Location = new Point(12, 8),
            Font = new Font("Segoe UI", 8.1f, FontStyle.Bold),
            ForeColor = Color.FromArgb(100, 116, 139), BackColor = Card
        });
    }

    static PillLabel NewPill() => new()
    {
        AutoSize = true, Padding = new Padding(8, 3, 8, 3),
        Font = new Font("Segoe UI", 7.7f, FontStyle.Bold)
    };

    static CheckBox NewCheckBox(string text) => new()
    {
        Text = text, AutoSize = true, ForeColor = Color.FromArgb(203, 213, 225),
        Font = new Font("Segoe UI", 8.1f, FontStyle.Bold), FlatStyle = FlatStyle.Flat,
        BackColor = Card, TabStop = false
    };

    static RoundedPanel NewCard(Rectangle bounds) => new()
    {
        Bounds = bounds, BackColor = Card, BorderColor = Border, BorderWidth = 1, CornerRadius = 13
    };

    RoundedButton MakeLocalButton(string text, int width, int height) => new()
    {
        Text = text, Size = new Size(width, height), BackColor = Color.FromArgb(20, 38, 60),
        ForeColor = Ink, HoverColor = Color.FromArgb(29, 50, 75), CornerRadius = 9,
        Font = new Font("Segoe UI", 8.4f, FontStyle.Bold), Cursor = Cursors.Hand, TabStop = false
    };

    RoundedButton MakeActionButton(string text, string actionName, int width, int height)
    {
        var button = new RoundedButton
        {
            Text = text, Size = new Size(width, height), Tag = actionName,
            AccessibleName = text, AccessibleDescription = $"Thao tác {text} cho worker hiện tại",
            UseMnemonic = false, Cursor = Cursors.Hand, Font = new Font("Segoe UI", 8.35f, FontStyle.Bold),
            BackColor = ButtonBack(actionName), ForeColor = ButtonFore(actionName),
            HoverColor = ButtonHover(actionName), CornerRadius = 8, TabStop = false
        };
        tips.SetToolTip(button, ShortcutFor(actionName));
        button.Click += async (s, _) => await InvokeActionAsync((string)((Button)s!).Tag!);
        actionButtons[actionName] = button;
        return button;
    }

    static Color ButtonBack(string action) => action switch
    {
        "run" => Color.FromArgb(37, 99, 235),
        "pause" => Color.FromArgb(72, 48, 18),
        "close" => Color.FromArgb(74, 24, 31),
        "recover" => Color.FromArgb(13, 57, 55),
        "save" or "save-archive" => Color.FromArgb(19, 47, 78),
        _ => Color.FromArgb(24, 45, 70)
    };

    static Color ButtonFore(string action) => action switch
    {
        "run" => Color.White,
        "pause" => Color.FromArgb(253, 230, 138),
        "close" => Color.FromArgb(254, 202, 202),
        "recover" => Color.FromArgb(153, 246, 228),
        "save" or "save-archive" => Color.FromArgb(191, 219, 254),
        _ => Ink
    };

    static Color ButtonHover(string action) => action switch
    {
        "run" => Color.FromArgb(29, 78, 216),
        "pause" => Color.FromArgb(92, 61, 20),
        "close" => Color.FromArgb(103, 31, 39),
        "recover" => Color.FromArgb(17, 76, 72),
        "save" or "save-archive" => Color.FromArgb(25, 64, 104),
        _ => Color.FromArgb(32, 56, 84)
    };

    static string ShortcutFor(string action) => action switch
    {
        "run" => "Ctrl+R", "pause" => "Ctrl+P", "focus" => "Ctrl+F",
        "health" => "Ctrl+H", "save" => "Ctrl+S", _ => ""
    };

    async Task InvokeActionAsync(string name)
    {
        if (name == "advanced-toggle")
        {
            ShowAdvanced();
            return;
        }

        SetActionNotice("Đang thực hiện…", false);
        foreach (var button in actionButtons.Values) button.Enabled = false;
        try
        {
            await action(workerId, name);
            if (actionStatus.Text == "Đang thực hiện…") SetActionNotice("✓ Hoàn tất", false);
        }
        catch (Exception ex)
        {
            SetActionNotice(FriendlyError(ex), true);
        }
        finally
        {
            foreach (var button in actionButtons.Values) button.Enabled = true;
        }
    }

    static string FriendlyError(Exception ex)
    {
        if (ex is TaskCanceledException
            || ex.Message.Contains("HttpClient.Timeout", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("CONTROLLER_TIMEOUT", StringComparison.OrdinalIgnoreCase))
            return "⚠ Controller phản hồi chậm. Thử lại sau.";
        var text = ex.Message.Replace("\r", " ").Replace("\n", " ").Trim();
        return text.Length > 88 ? "⚠ " + text[..85] + "…" : "⚠ " + text;
    }

    internal void SetActionNotice(string text, bool isError)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => SetActionNotice(text, isError)));
            return;
        }
        actionStatus.ForeColor = isError ? Red : (text.StartsWith("✓") ? Green : Muted);
        actionStatus.Text = text;
    }

    void ShowAdvanced()
    {
        advancedForm ??= new AdvancedInfoForm();
        advancedForm.SetWorker(workerId, advancedLines);
        if (!advancedForm.Visible) advancedForm.Show(this);
        else advancedForm.Activate();
    }

    public bool ShowWorker(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog, WorkerSettings settings,
        ScheduleSettings? scheduleSettings, bool doNotDisturb, string[] recentLogs, Point defaultLocation, Rectangle workingArea)
    {
        workerId = worker.Id;
        Text = $"TigerIQ Worker Utility — {worker.Id}";
        var accent = WorkerAccent(worker.Id);
        headerCard.BorderColor = accent;
        foreach (Control control in headerCard.Controls)
            if (Equals(control.Tag, "accent")) control.BackColor = accent;

        workerGlyph.Text = worker.Id[2..];
        workerGlyph.BackColor = accent;
        workerName.Text = $"{worker.Id} · {worker.Name}";

        onlineChip.Text = view.WindowOpen && view.SessionOk ? "● ONLINE" : "● OFFLINE";
        onlineChip.BackColor = view.WindowOpen && view.SessionOk ? Color.FromArgb(13, 65, 49) : Color.FromArgb(74, 24, 31);
        onlineChip.ForeColor = view.WindowOpen && view.SessionOk ? Green : Red;

        stateChip.Text = StateText(view.State);
        stateChip.BackColor = view.State switch
        {
            WorkerUiState.Ready => Color.FromArgb(13, 65, 49),
            WorkerUiState.Working => Color.FromArgb(25, 58, 91),
            WorkerUiState.Paused => Color.FromArgb(72, 48, 18),
            _ => Color.FromArgb(74, 24, 31)
        };
        stateChip.ForeColor = view.State switch
        {
            WorkerUiState.Ready => Green,
            WorkerUiState.Working => Color.FromArgb(147, 197, 253),
            WorkerUiState.Paused => Amber,
            _ => Red
        };

        healthChip.Text = HealthText(watchdog?.Health);
        healthChip.BackColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Color.FromArgb(13, 65, 49),
            HealthBand.Slow => Color.FromArgb(72, 48, 18),
            HealthBand.Stalled or HealthBand.Blocked => Color.FromArgb(74, 24, 31),
            HealthBand.Recovering => Color.FromArgb(25, 58, 91),
            _ => Color.FromArgb(20, 38, 60)
        };
        healthChip.ForeColor = watchdog?.Health switch
        {
            HealthBand.Healthy => Green,
            HealthBand.Slow => Amber,
            HealthBand.Recovering => Color.FromArgb(147, 197, 253),
            HealthBand.Stalled or HealthBand.Blocked => Red,
            _ => Muted
        };

        if (actionButtons.TryGetValue("run", out var run))
        {
            run.BackColor = accent;
            run.HoverColor = ControlPaint.Dark(accent, .12f);
        }

        var elapsed = settings.StateChangedAt is DateTimeOffset since ? DateTimeOffset.Now - since : TimeSpan.Zero;
        job.Text = $"Job hiện tại  {view.JobId ?? "—"}   {elapsed:hh\\:mm\\:ss}";
        var heartbeat = watchdog is null || watchdog.AliveAge == TimeSpan.MaxValue ? "—" : watchdog.AliveAge.ToString(@"mm\:ss");
        reason.Text = $"{ShortReason(view.Reason)} · heartbeat {heartbeat}";

        scheduleText.Text = scheduleSettings?.NextCheckAt is DateTimeOffset next && scheduleSettings.Enabled
            ? $"↪ Lần kiểm tra kế tiếp: {next.ToLocalTime():HH:mm:ss}"
            : "↪ Lịch kiểm tra: chưa bật";

        suppressScheduleEvents = true;
        scheduleEnabled.Checked = scheduleSettings?.Enabled ?? false;
        changeOnly.Checked = scheduleSettings?.ChangesOnly ?? true;
        suppressScheduleEvents = false;

        var friendlyLogs = recentLogs.Length == 0
            ? new[] { "Chưa có log." }
            : recentLogs.TakeLast(2).Select(FriendlyLog).ToArray();
        logSummary.Text = string.Join(Environment.NewLine, friendlyLogs);

        advancedLines = BuildAdvancedLines(worker, view, watchdog, settings, scheduleSettings, doNotDisturb);
        if (advancedForm?.Visible == true) advancedForm.SetWorker(workerId, advancedLines);

        var saved = settings.PopupX is int x && settings.PopupY is int y ? new Point?(new Point(x, y)) : null;
        var target = UiPlacement.ResolvePopup(saved, defaultLocation, Size, workingArea);
        suppressPositionEvent = true;
        Location = target;
        suppressPositionEvent = false;
        if (!Visible) Show();
        Activate();
        ActiveControl = null;
        return true;
    }

    static string ShortReason(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "Không có cảnh báo";
        return value switch
        {
            "READY" => "Sẵn sàng",
            "JOB_ACTIVE" => "Đang xử lý",
            "UTILITY_PAUSED" => "Đã tạm dừng",
            "CONTROLLER_UNAVAILABLE" => "Controller chưa sẵn sàng",
            _ => value.Replace('_', ' ')
        };
    }

    static string FriendlyLog(string line)
    {
        var text = line.Replace("POPUP_POSITION_SAVED", "Đã lưu vị trí bảng")
            .Replace("ACTION_OK", "Thao tác hoàn tất")
            .Replace("ACTION_REQUEST", "Đang thực hiện")
            .Replace("STATE_CHANGED", "Trạng thái thay đổi");
        return text.Length > 64 ? text[..61] + "…" : text;
    }

    static string StateText(WorkerUiState state) => state switch
    {
        WorkerUiState.Ready => "● SẴN SÀNG",
        WorkerUiState.Working => "● ĐANG CHẠY",
        WorkerUiState.Paused => "● TẠM DỪNG",
        _ => "● BỊ CHẶN"
    };

    static string HealthText(HealthBand? health) => health switch
    {
        HealthBand.Healthy => "✓ ỔN ĐỊNH",
        HealthBand.Slow => "◷ CHẬM",
        HealthBand.Stalled => "! TREO",
        HealthBand.Recovering => "↻ KHÔI PHỤC",
        HealthBand.Blocked => "! BỊ CHẶN",
        _ => "• CHƯA RÕ"
    };

    static Color WorkerAccent(string id) => id switch
    {
        "NV02" => Color.FromArgb(37, 99, 235),
        "NV03" => Color.FromArgb(168, 85, 247),
        "NV04" => Color.FromArgb(6, 182, 212),
        _ => Color.FromArgb(59, 130, 246)
    };

    static string[] BuildAdvancedLines(WorkerDefinition worker, WorkerView view, WatchdogView? watchdog,
        WorkerSettings settings, ScheduleSettings? scheduleSettings, bool doNotDisturb)
    {
        var heartbeat = view.HeartbeatAt?.ToLocalTime().ToString("HH:mm:ss dd/MM") ?? "chưa có dữ liệu";
        return
        [
            $"Worker       : {worker.Id} — {worker.Name}",
            $"CDP port     : {worker.DebugPort}",
            $"Session      : {(view.SessionOk ? "OK" : "KHÔNG ĐẠT")}",
            $"Window       : {(view.WindowOpen ? "OPEN" : "CLOSED")}",
            $"UI ready     : {view.UiReady}",
            $"Heartbeat    : {heartbeat}",
            $"Login/Auth   : {(view.AuthRequired ? "CẦN ĐĂNG NHẬP" : "không yêu cầu")}",
            $"Security     : {view.SecurityBlock ?? "không có cảnh báo"}",
            $"URL          : {view.Url ?? "chưa có dữ liệu"}",
            $"Health       : {watchdog?.Health.ToString() ?? "chưa có dữ liệu"}",
            $"Khóa vị trí  : {(settings.PositionLocked ? "BẬT" : "TẮT")}",
            $"Không làm phiền: {(doNotDisturb ? "BẬT" : "TẮT")}",
            $"Lịch         : {(scheduleSettings?.Enabled == true ? $"{scheduleSettings.IntervalMinutes} phút" : "TẮT")}"
        ];
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

internal sealed class AdvancedInfoForm : Form
{
    readonly Label title = new()
    {
        AutoSize = false, Location = new Point(16, 14), Size = new Size(340, 24),
        ForeColor = Color.White, Font = new Font("Segoe UI", 11, FontStyle.Bold)
    };
    readonly Label details = new()
    {
        AutoSize = false, Location = new Point(16, 48), Size = new Size(388, 300),
        ForeColor = Color.FromArgb(203, 213, 225), Font = new Font("Consolas", 8.3f),
        BackColor = Color.FromArgb(5, 13, 25)
    };

    public AdvancedInfoForm()
    {
        Text = "TigerIQ — Thông tin kỹ thuật";
        ClientSize = new Size(420, 364);
        MinimumSize = Size;
        MaximumSize = Size;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(5, 13, 25);
        Controls.Add(title);
        Controls.Add(details);
    }

    public void SetWorker(string workerId, string[] lines)
    {
        title.Text = $"{workerId} — Thông tin kỹ thuật";
        details.Text = string.Join(Environment.NewLine, lines);
    }
}

internal sealed class RoundedPanel : Panel
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
        HandleCreated += (_, _) => RefreshRegion();
        TextChanged += (_, _) =>
        {
            if (IsHandleCreated) BeginInvoke(new Action(RefreshRegion));
        };
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
