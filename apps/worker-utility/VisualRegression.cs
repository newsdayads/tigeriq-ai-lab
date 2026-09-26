using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace TigerIQ.WorkerUtility;

internal static class VisualRegression
{
    // Filled after the first exact Windows-CI render on this branch.
    internal const string PopupPixelBaseline = "39afe0fdf318bae8ebc9539a177ea005ea6a02a5592d64d8bd60b6dcb6c7192c";
    internal const string TrayPixelBaseline = "48afe9b69796a96531da5e4adf91f73573daa7177dc4c443e7d6de9553bc947c";
    internal const string AdvancedPixelBaseline = "0c06c06b77bf2a70813a850d4fdb1fa3767beb8e14d65c212f7d411e7efe438c";
    internal const string BadgePixelBaseline = "44f6e9baf3094c3c723f553d6fe6e3ec80ded21b42287d70d96605992183c5a7";
    internal const string PopupGeometryBaseline = "7e72ce90222a339096d31360ddec85f77957c633ed7f7e03485e20a312579ae5";
    internal const string TrayGeometryBaseline = "15aee6afc62de0f69cdc765bcc7718b2c14bca7549d256a4d0bad5d69667051b";
    internal const string AdvancedGeometryBaseline = "81c3d7bbb47985f3cbdf1af47faf0ba40b61c609ac4ef59049b905ca739060d9";
    internal const string BadgeGeometryBaseline = "1441bfd48d609a9aa3872c4a366c3210b44d2c0f5edc62059119d046e25bc9ed";

    public static void Run()
    {
        using var popup = new PopupForm((_, _) => Task.CompletedTask, (_, _) => { });
        using var tray = new TrayPanelForm(_ => { }, () => { }, () => { }, () => { }, () => { }, () => { });
        using var advanced = new AdvancedInfoForm(_ => Task.CompletedTask);
        using var badge = new BadgeForm(Workers.Get("NV02"), _ => { }, (_, _) => { }, _ => { });

        foreach (var form in new Form[] { popup, tray, advanced, badge }) Prepare(form);

        AssertContained(popup, "popup");
        AssertContained(tray, "tray");
        AssertContained(advanced, "advanced");
        AssertContained(badge, "badge");

        var popupPixels = PixelHash(popup);
        var trayPixels = PixelHash(tray);
        var advancedPixels = PixelHash(advanced);
        var badgePixels = PixelHash(badge);
        var popupGeometry = GeometryHash(popup);
        var trayGeometry = GeometryHash(tray);
        var advancedGeometry = GeometryHash(advanced);
        var badgeGeometry = GeometryHash(badge);

        Console.WriteLine($"VISUAL_REGRESSION popup_pixels={popupPixels} tray_pixels={trayPixels} advanced_pixels={advancedPixels} badge_pixels={badgePixels}");
        Console.WriteLine($"VISUAL_GEOMETRY popup={popupGeometry} tray={trayGeometry} advanced={advancedGeometry} badge={badgeGeometry}");

        AssertBaseline("popup pixels", popupPixels, PopupPixelBaseline);
        AssertBaseline("tray pixels", trayPixels, TrayPixelBaseline);
        AssertBaseline("advanced pixels", advancedPixels, AdvancedPixelBaseline);
        AssertBaseline("badge pixels", badgePixels, BadgePixelBaseline);
        AssertBaseline("popup geometry", popupGeometry, PopupGeometryBaseline);
        AssertBaseline("tray geometry", trayGeometry, TrayGeometryBaseline);
        AssertBaseline("advanced geometry", advancedGeometry, AdvancedGeometryBaseline);
        AssertBaseline("badge geometry", badgeGeometry, BadgeGeometryBaseline);
    }

    static void AssertBaseline(string name, string actual, string expected)
    {
        if (expected != "PENDING" && !string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"{name} visual regression: expected {expected}, got {actual}");
    }

    static void Prepare(Form form)
    {
        // Force the real WinForms docking/layout engine to materialize all nested controls.
        // Hidden TabPages otherwise keep design-time placeholder sizes and create false clipping reports.
        form.CreateControl();
        form.Show();
        Application.DoEvents();
        LayoutTree(form);
        form.Hide();
    }

    static void LayoutTree(Control root)
    {
        root.CreateControl();
        root.PerformLayout();
        foreach (Control child in root.Controls) LayoutTree(child);
        root.PerformLayout();
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
