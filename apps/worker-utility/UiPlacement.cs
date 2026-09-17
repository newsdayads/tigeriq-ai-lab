namespace TigerIQ.WorkerUtility;

internal static class UiPlacement
{
    public static Point Clamp(Point desired, Size size, Rectangle workingArea)
    {
        var x = Math.Clamp(desired.X, workingArea.Left, Math.Max(workingArea.Left, workingArea.Right - size.Width));
        var y = Math.Clamp(desired.Y, workingArea.Top, Math.Max(workingArea.Top, workingArea.Bottom - size.Height));
        return new Point(x, y);
    }

    public static Point DefaultBadge(Rectangle chromeBounds, Size badgeSize, Rectangle workingArea)
    {
        const int gap = 6;
        var right = new Point(chromeBounds.Right + gap, chromeBounds.Top + 8);
        if (right.X + badgeSize.Width <= workingArea.Right)
            return Clamp(right, badgeSize, workingArea);

        var left = new Point(chromeBounds.Left - badgeSize.Width - gap, chromeBounds.Top + 8);
        if (left.X >= workingArea.Left)
            return Clamp(left, badgeSize, workingArea);

        // Maximized/FancyZones fallback: use the left side of Chrome's title strip,
        // well away from the Minimize/Maximize/Close system controls and page content.
        return Clamp(new Point(chromeBounds.Left + 8, chromeBounds.Top + 4), badgeSize, workingArea);
    }

    public static Point BadgeFromOffset(Rectangle chromeBounds, Size badgeSize, Rectangle workingArea, int offsetX, int offsetY)
        => Clamp(new Point(chromeBounds.Left + offsetX, chromeBounds.Top + offsetY), badgeSize, workingArea);

    public static Point DefaultPopup(Rectangle chromeBounds, Size popupSize, Rectangle workingArea)
    {
        const int gap = 8;
        var right = new Point(chromeBounds.Right + gap, chromeBounds.Top + 42);
        if (right.X + popupSize.Width <= workingArea.Right)
            return Clamp(right, popupSize, workingArea);

        var left = new Point(chromeBounds.Left - popupSize.Width - gap, chromeBounds.Top + 42);
        if (left.X >= workingArea.Left)
            return Clamp(left, popupSize, workingArea);

        return Clamp(new Point(chromeBounds.Right - popupSize.Width - 12, chromeBounds.Top + 54), popupSize, workingArea);
    }
}
