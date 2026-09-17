using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace TigerIQ.WorkerUtility;

internal sealed class WindowBinder
{
    const string ConfigPath = @"D:\TigerIQ\Apps\ChromeController\Config\chrome-controller.json";
    readonly Dictionary<string, (int Left, int Top)> expected = new();
    readonly Dictionary<string, nint> handles = new();

    public WindowBinder()
    {
        LoadExpected();
    }

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
        if (handles.TryGetValue(workerId, out hwnd) && IsWindow(hwnd) && GetWindowRect(hwnd, out var current))
        {
            rect = current.ToRectangle();
            return true;
        }
        handles.Remove(workerId);
        if (!expected.TryGetValue(workerId, out var anchor)) { hwnd = 0; return false; }

        var candidates = EnumerateChromeWindows()
            .Where(x => x.Rect.Width >= 400 && x.Rect.Height >= 600)
            .Select(x => new { x.Hwnd, x.Rect, Distance = Math.Abs(x.Rect.Left-anchor.Left) + Math.Abs(x.Rect.Top-anchor.Top) })
            .OrderBy(x => x.Distance).ToList();
        var best = candidates.FirstOrDefault();
        if (best is null || best.Distance > 180 || handles.Values.Contains(best.Hwnd)) { hwnd = 0; return false; }
        handles[workerId] = best.Hwnd;
        hwnd = best.Hwnd;
        rect = best.Rect;
        return true;
    }

    public bool Focus(string workerId)
        => TryResolve(workerId, out var hwnd, out _) && SetForegroundWindow(hwnd);

    public bool MoveTo(string workerId, int left, int top, int width, int height)
        => TryResolve(workerId, out var hwnd, out _) && MoveWindow(hwnd, left, top, width, height, true);
    static List<(nint Hwnd, Rectangle Rect)> EnumerateChromeWindows()
    {
        var rows = new List<(nint, Rectangle)>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var cls = new StringBuilder(128);
            GetClassName(hwnd, cls, cls.Capacity);
            if (!string.Equals(cls.ToString(), "Chrome_WidgetWin_1", StringComparison.Ordinal)) return true;
            if (GetWindowRect(hwnd, out var r)) rows.Add((hwnd, r.ToRectangle()));
            return true;
        }, 0);
        return rows;
    }

    delegate bool EnumWindowsProc(nint hWnd, nint lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(nint hWnd);
    [DllImport("user32.dll")] static extern bool IsWindow(nint hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(nint hWnd, StringBuilder lpClassName, int nMaxCount);
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
