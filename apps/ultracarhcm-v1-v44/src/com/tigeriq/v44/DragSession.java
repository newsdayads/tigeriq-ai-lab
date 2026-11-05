package com.tigeriq.v44;
import java.util.List;

/** Bind gesture to immutable source session ID and layout revision until release. */
public final class DragSession {
    private final String source;
    private final long revision;
    public DragSession(ExactCardIndex measured, float rawX, float rawY) {
        if (measured == null) throw new IllegalArgumentException("layout missing");
        source = measured.sourceAtGrip(rawX,rawY);
        revision = measured.revision;
    }
    public boolean started() { return source != null; }
    public String sourceId() { return source; }
    public List<String> release(ExactCardIndex measured, float rawX, float rawY, List<String> currentOrder) {
        if (currentOrder == null) throw new IllegalArgumentException("missing current order");
        if (source == null || measured == null || measured.revision != revision || !measured.has(source))
            return SessionOrder.checked(currentOrder);
        String target=measured.destinationAtCard(rawX,rawY);
        return target == null ? SessionOrder.checked(currentOrder) : SessionOrder.move(currentOrder,source,target);
    }
}
