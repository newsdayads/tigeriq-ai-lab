using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace TigerIQ.WorkerUtility;

internal static class VisualRegression
{
    // Filled after the first exact Windows-CI render on this branch.
    internal const string PopupPixelBaseline = "PENDING";
    internal const string TrayPixelBaseline = "PENDING";

    public static void Run()
    {
        using var popup = new PopupForm((_, _) => Task.CompletedTask, (_, _) => { });
        using var tray = new TrayPanelForm(_ => { }, () => { }, () => { }, () => { }, () => { }, () => { });

        Prepare(popup);
        Prepare(tray);

        AssertContained(popup, "popup");
        AssertContained(tray, "tray");

        var popupPixels = PixelHash(popup);
        var trayPixels = PixelHash(tray);
        var popupGeometry = GeometryHash(popup);
        var trayGeometry = GeometryHash(tray);

        Console.WriteLine($"VISUAL_REGRESSION popup_pixels={popupPixels} tray_pixels={trayPixels}");
        Console.WriteLine($"VISUAL_GEOMETRY popup={popupGeometry} tray={trayGeometry}");

        if (PopupPixelBaseline != "PENDING" && !string.Equals(popupPixels, PopupPixelBaseline, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"popup visual regression: expected {PopupPixelBaseline}, got {popupPixels}");
        if (TrayPixelBaseline != "PENDING" && !string.Equals(trayPixels, TrayPixelBaseline, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"tray visual regression: expected {TrayPixelBaseline}, got {trayPixels}");
    }

    static void Prepare(Form form)
    {
        form.CreateControl();
        form.PerformLayout();
        foreach (Control child in form.Controls) child.PerformLayout();
    }

    static void AssertContained(Control root, string name)
    {
        foreach (Control child in root.Controls)
        {
            if (!root.ClientRectangle.Contains(child.Bounds))
                throw new InvalidOperationException($"{name} clipped: {child.GetType().Name} {child.Bounds} outside {root.ClientRectangle}");
            AssertContained(child, name + "/" + child.GetType().Name);
        }
    }

    static string GeometryHash(Control root)
    {
        var sb = new StringBuilder();
        Append(root, sb, 0);
        return Hex(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())));
    }

    static void Append(Control c, StringBuilder sb, int depth)
    {
        sb.Append(depth).Append('|').Append(c.GetType().Name).Append('|')
          .Append(c.Left).Append(',').Append(c.Top).Append(',').Append(c.Width).Append(',').Append(c.Height).Append('|')
          .Append(c.Padding.Left).Append(',').Append(c.Padding.Top).Append(',').Append(c.Padding.Right).Append(',').Append(c.Padding.Bottom).Append('|')
          .Append(c.Margin.Left).Append(',').Append(c.Margin.Top).Append(',').Append(c.Margin.Right).Append(',').Append(c.Margin.Bottom).Append('|')
          .Append(c.BackColor.ToArgb()).Append('|').Append(c.ForeColor.ToArgb()).AppendLine();
        foreach (Control child in c.Controls) Append(child, sb, depth + 1);
    }

    static string PixelHash(Form form)
    {
        using var bitmap = new Bitmap(form.ClientSize.Width, form.ClientSize.Height, PixelFormat.Format32bppArgb);
        form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, form.ClientSize));
        var rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        var data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var bytes = new byte[Math.Abs(data.Stride) * data.Height];
            Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
            return Hex(SHA256.HashData(bytes));
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
}
