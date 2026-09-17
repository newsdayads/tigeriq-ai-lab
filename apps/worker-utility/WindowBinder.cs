using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal sealed class WindowBinder
{
    const string ConfigPath = @"D:\TigerIQ\Apps\ChromeController\Config\chrome-controller.json";
    readonly Dictionary<string, (int Left, int Top)> expected = new();
    readonly Dictionary<string, nint> handles = new();

    public WindowBinder() => LoadExpected();

    void LoadExpected()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(ConfigPath));
            foreach (var w in doc.RootElement.GetProperty("workers").EnumerateArray())
            {
                var id = w.GetProperty("id").GetString()!;
                var left = w.TryGetProperty("savedLeft", out var l) ? l.GetInt32() : 0;
                var top = w.TryGetProperty("savedTop", out var t) ? t.GetInt32() : 0;
                expected[id] = (left, top);
            }
        }
        catch { }
    }
    public bool TryResolve(string workerId, out nint hwnd, out Rectangle rect)
    {
        rect = Rectangle.Empty;
        if (!expected.TryGetValue(workerId, out var anchor)) { hwnd = 0; return false; }
        if (handles.TryGetValue(workerId, out hwnd) && IsWindow(hwnd) && GetWindowRect(hwnd, out var current))
        {
            var currentRect = current.ToRectangle();
            var title = GetTitle(hwnd);
            if (TitleMatches(workerId, title) || NearAnchor(currentRect, anchor, 180))
            {
                rect = currentRect;
                return true;
            }
        }
        handles.Remove(workerId);
        var used = handles.Values.ToHashSet();
        var candidates = EnumerateChromeWindows()
            .Where(x => x.Rect.Width >= 400 && x.Rect.Height >= 600 && !used.Contains(x.Hwnd))
            .Select(x => new { x.Hwnd, x.Rect, x.Title, Distance = Distance(x.Rect, anchor) })
            .ToList();
        var best = candidates.FirstOrDefault(x => TitleMatches(workerId, x.Title))
            ?? candidates.OrderBy(x => x.Distance).FirstOrDefault();
        if (best is null || (!TitleMatches(workerId, best.Title) && best.Distance > 180)) { hwnd = 0; return false; }
        handles[workerId] = best.Hwnd;
        hwnd = best.Hwnd;
        rect = best.Rect;
        return true;
    }
    static int Distance(Rectangle rect, (int Left, int Top) anchor)
        => Math.Abs(rect.Left - anchor.Left) + Math.Abs(rect.Top - anchor.Top);
    static bool NearAnchor(Rectangle rect, (int Left, int Top) anchor, int max)
        => Distance(rect, anchor) <= max;
    static bool TitleMatches(string workerId, string title)
        => title.Contains($"[{workerId} |", StringComparison.OrdinalIgnoreCase)
            || title.Contains($"{workerId} -", StringComparison.OrdinalIgnoreCase);
    static string GetTitle(nint hwnd)
    {
        var text = new StringBuilder(256);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }

    public bool Focus(string workerId)
        => TryResolve(workerId, out var hwnd, out _) && SetForegroundWindow(hwnd);
    public bool MoveTo(string workerId, int left, int top, int width, int height)
        => TryResolve(workerId, out var hwnd, out _) && MoveWindow(hwnd, left, top, width, height, true);

    static List<(nint Hwnd, Rectangle Rect, string Title)> EnumerateChromeWindows()
    {
        var rows = new List<(nint, Rectangle, string)>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var cls = new StringBuilder(128);
            GetClassName(hwnd, cls, cls.Capacity);
            if (!string.Equals(cls.ToString(), "Chrome_WidgetWin_1", StringComparison.Ordinal)) return true;            if (GetWindowRect(hwnd, out var r)) rows.Add((hwnd, r.ToRectangle(), GetTitle(hwnd)));
            return true;
        }, 0);
        return rows;
    }

    delegate bool EnumWindowsProc(nint hWnd, nint lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(nint hWnd);
    [DllImport("user32.dll")] static extern bool IsWindow(nint hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(nint hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(nint hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] static extern bool GetWindowRect(nint hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(nint hWnd);
    [DllImport("user32.dll")] static extern bool MoveWindow(nint hWnd, int x, int y, int width, int height, bool repaint);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT
    {
        public int Left, Top, Right, Bottom;
        public Rectangle ToRectangle() => Rectangle.FromLTRB(Left, Top, Right, Bottom);
    }
}
