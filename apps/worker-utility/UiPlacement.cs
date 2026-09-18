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

    public static bool TryBadge(Rectangle chromeBounds, Size badgeSize, Rectangle workingArea,
        int? offsetX, int? offsetY, out Point target)
    {
        target = Point.Empty;
        var ownTitleArea = Rectangle.Intersect(
            new Rectangle(chromeBounds.Left, chromeBounds.Top, chromeBounds.Width, Math.Min(44, chromeBounds.Height)),
            workingArea);
        if (ownTitleArea.Width < badgeSize.Width || ownTitleArea.Height < badgeSize.Height)
            return false;

        var desired = offsetX is int x && offsetY is int y
            ? new Point(chromeBounds.Left + x, chromeBounds.Top + y)
            : new Point(chromeBounds.Left + 10, chromeBounds.Top + 4);
        target = Clamp(desired, badgeSize, ownTitleArea);
        return true;
    }


    public static Point DockedPopup(int workerIndex, int workerCount, Size popupSize, Rectangle workingArea)
    {
        const int margin = 8;
        const int gap = 8;
        workerIndex = Math.Clamp(workerIndex, 0, Math.Max(0, workerCount - 1));
        workerCount = Math.Max(1, workerCount);

        var totalWidth = popupSize.Width * workerCount + gap * (workerCount - 1);
        var startX = workingArea.Right - margin - totalWidth;
        if (startX < workingArea.Left + margin) startX = workingArea.Left + margin;
        var x = startX + workerIndex * (popupSize.Width + gap);
        var y = workingArea.Bottom - margin - popupSize.Height;
        return Clamp(new Point(x, y), popupSize, workingArea);
    }

    public static Point ResolvePopup(Point? savedLocation, Point defaultLocation, Size popupSize, Rectangle workingArea)
    {
        if (savedLocation is Point saved)
            return Clamp(saved, popupSize, workingArea);
        return Clamp(defaultLocation, popupSize, workingArea);
    }

    public static bool TryPopup(Rectangle anchor, Size popupSize, Rectangle[] workingAreas, Rectangle[] occupied,
        Point? savedLocation, out Point target)
    {
        target = Point.Empty;
        if (workingAreas.Length == 0 || popupSize.Width <= 0 || popupSize.Height <= 0) return false;

        var blockers = occupied
            .Where(r => r.Width > 0 && r.Height > 0)
            .Select(r => Rectangle.Inflate(r, SafetyGap, SafetyGap))
            .ToArray();

        bool Available(Point point, Rectangle area)
        {
            var rect = new Rectangle(point, popupSize);
            return area.Contains(rect) && blockers.All(b => !b.IntersectsWith(rect));
        }

        // Preserve a saved location only when that exact rectangle is still safe.
        // Never clamp it onto another monitor because that can silently create overlap.
        if (savedLocation is Point saved)
        {
            foreach (var area in workingAreas)
            {
                if (!Available(saved, area)) continue;
                target = saved;
                return true;
            }
        }

        var orderedAreas = workingAreas
            .OrderByDescending(area => area.IntersectsWith(anchor))
            .ThenBy(area => DistanceSquared(area, anchor))
            .ToArray();

        // Approved Layout 2: the selected worker popup belongs ON TOP OF its own Chrome,
        // while other worker windows remain blockers. Prefer a consistent inset overlay.
        foreach (var area in orderedAreas)
        {
            var overlay = new Point(anchor.Left + 10, anchor.Top + 54);
            if (Available(overlay, area))
            {
                target = overlay;
                return true;
            }
        }

        foreach (var area in orderedAreas)
        {
            if (popupSize.Width > area.Width || popupSize.Height > area.Height) continue;
            var local = blockers.Where(b => b.IntersectsWith(area)).ToArray();

            // For axis-aligned blockers, any feasible fixed-size rectangle can be slid
            // left/up until it touches a working-area edge or blocker edge. Therefore
            // the Cartesian product of these critical x/y edges is geometry-complete;
            // it finds a free rectangle whenever one exists without pixel-by-pixel scans.
            var xs = new HashSet<int> { area.Left, area.Right - popupSize.Width };
            var ys = new HashSet<int> { area.Top, area.Bottom - popupSize.Height };
            foreach (var blocker in local)
            {
                xs.Add(blocker.Left - popupSize.Width);
                xs.Add(blocker.Right);
                ys.Add(blocker.Top - popupSize.Height);
                ys.Add(blocker.Bottom);
            }

            var candidates =
                from x in xs
                where x >= area.Left && x + popupSize.Width <= area.Right
                from y in ys
                where y >= area.Top && y + popupSize.Height <= area.Bottom
                let point = new Point(x, y)
                orderby DistanceSquared(new Rectangle(point, popupSize), anchor)
                select point;

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

    static long DistanceSquared(Rectangle a, Rectangle b)
    {
        var ax = (long)a.Left + a.Width / 2L;
        var ay = (long)a.Top + a.Height / 2L;
        var bx = (long)b.Left + b.Width / 2L;
        var by = (long)b.Top + b.Height / 2L;
        var dx = ax - bx;
        var dy = ay - by;
        return dx * dx + dy * dy;
    }
}
