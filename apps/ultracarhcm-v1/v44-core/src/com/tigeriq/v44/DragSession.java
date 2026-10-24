package com.tigeriq.v44;
import java.util.List;
/** Binds exact pointer-down grip ID to an immutable snapshot until exact-card drop. */
public final class DragSession {
    private final String source;
    private final long revision;
    public DragSession(ExactCardIndex measuredAtDown, float rawX, float rawY) {
        if (measuredAtDown == null) throw new IllegalArgumentException("layout missing");
        source = measuredAtDown.sourceAtGrip(rawX, rawY);
        revision = measuredAtDown.revision;
    }
    public boolean started() { return source != null; }
    public String sourceId() { return source; }
    public List<String> release(ExactCardIndex measuredAtUp, float rawX, float rawY, List<String> currentOrder) {
        if (currentOrder == null) throw new IllegalArgumentException("missing current order");
        if (source == null || measuredAtUp == null || measuredAtUp.revision != revision || !measuredAtUp.has(source))
            return SessionOrder.checked(currentOrder);
        String target = measuredAtUp.destinationAtCard(rawX, rawY);
        return target == null ? SessionOrder.checked(currentOrder) : SessionOrder.move(currentOrder, source, target);
    }
}
