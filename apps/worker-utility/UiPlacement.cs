namespace TigerIQ.WorkerUtility;

internal static class UiPlacement
{
    const int SafetyGap = 10;

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

        // Badge-only fallback: keep the tiny native badge in Chrome's title strip,
        // away from Minimize/Maximize/Close and page content.
        return Clamp(new Point(chromeBounds.Left + 8, chromeBounds.Top + 4), badgeSize, workingArea);
    }

    public static Point BadgeFromOffset(Rectangle chromeBounds, Size badgeSize, Rectangle workingArea, int offsetX, int offsetY)
        => Clamp(new Point(chromeBounds.Left + offsetX, chromeBounds.Top + offsetY), badgeSize, workingArea);

    public static bool TryPopup(Rectangle anchor, Size popupSize, Rectangle[] workingAreas, Rectangle[] occupied,
        Point? savedLocation, out Point target)
    {
        target = Point.Empty;
        if (workingAreas.Length == 0) return false;

        var blockers = occupied
            .Where(r => r.Width > 0 && r.Height > 0)
            .Select(r => Rectangle.Inflate(r, SafetyGap, SafetyGap))
            .ToArray();

        bool Available(Point point, Rectangle area)
        {
            var rect = new Rectangle(point, popupSize);
            return area.Contains(rect) && blockers.All(b => !b.IntersectsWith(rect));
        }

        if (savedLocation is Point saved)
        {
            foreach (var area in workingAreas)
            {
                var clamped = Clamp(saved, popupSize, area);
                if (Available(clamped, area))
                {
                    target = clamped;
                    return true;
                }
            }
        }

        var orderedAreas = workingAreas
            .OrderByDescending(area => area.IntersectsWith(anchor))
            .ThenBy(area => Math.Abs(area.Left - anchor.Left))
            .ToArray();

        foreach (var area in orderedAreas)
        {
            var local = blockers.Where(b => b.IntersectsWith(area)).ToArray();
            var candidates = new List<Point>();

            if (local.Length > 0)
            {
                var minLeft = local.Min(b => b.Left);
                var maxRight = local.Max(b => b.Right);
                candidates.Add(new Point(minLeft - popupSize.Width - SafetyGap, area.Top + 12));
                candidates.Add(new Point(maxRight + SafetyGap, area.Top + 12));
            }

            candidates.Add(new Point(area.Left + 12, area.Top + 12));
            candidates.Add(new Point(area.Right - popupSize.Width - 12, area.Top + 12));
            candidates.Add(new Point(area.Left + 12, area.Bottom - popupSize.Height - 12));
            candidates.Add(new Point(area.Right - popupSize.Width - 12, area.Bottom - popupSize.Height - 12));

            foreach (var candidate in candidates)
            {
                if (!Available(candidate, area)) continue;
                target = candidate;
                return true;
            }
        }

        // Deliberately fail closed instead of covering any Chrome worker.
        return false;
    }
}
