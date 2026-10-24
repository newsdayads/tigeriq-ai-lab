package com.tigeriq.v44;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.nio.charset.StandardCharsets;
/** Exactly five persisted quick slots by immutable saved-layout ID, never by title. */
public final class QuickSlots {
    public static final int COUNT = 5;
    private final List<String> slots;
    private QuickSlots(List<String> items) { slots = Collections.unmodifiableList(items); }
    public static QuickSlots empty() {
        List<String> items = new ArrayList<String>();
        for (int i = 0; i < COUNT; i++) items.add("");
        return new QuickSlots(items);
    }
    public String get(int slot) { checkSlot(slot); return slots.get(slot); }
    public QuickSlots assign(int slot, String sessionId, Set<String> existingIds) {
        checkSlot(slot);
        if (existingIds == null) throw new IllegalArgumentException("ids required");
        if (sessionId == null) sessionId = "";
        if (!sessionId.isEmpty() && (!SessionOrder.validId(sessionId) || !existingIds.contains(sessionId)))
            throw new IllegalArgumentException("unknown session ID");
        List<String> next = new ArrayList<String>(slots);
        next.set(slot, sessionId);
        return new QuickSlots(next);
    }
    /** Deleted/missing assignment cannot launch wrong session, and is not silently erased. */
    public String visibleId(int slot, Set<String> existingIds) {
        String id = get(slot);
        return existingIds != null && existingIds.contains(id) ? id : "";
    }
    public String encode() {
        StringBuilder b = new StringBuilder("v44slots");
        for (String id : slots) {
            b.append('|');
            if (!id.isEmpty())
                b.append(Base64.getUrlEncoder().withoutPadding().encodeToString(id.getBytes(StandardCharsets.UTF_8)));
        }
        return b.toString();
    }
    public static QuickSlots decode(String text) {
        if (text == null || text.isEmpty()) return empty();
        String[] p = text.split("\\|", -1);
        if (p.length != COUNT + 1 || !"v44slots".equals(p[0]))
            throw new IllegalArgumentException("invalid slots format");
        List<String> result = new ArrayList<String>();
        for (int i = 1; i < p.length; i++) {
            String id;
            try {
                id = p[i].isEmpty() ? "" : new String(Base64.getUrlDecoder().decode(p[i]), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) { throw new IllegalArgumentException("invalid slot encoding", e); }
            if (!id.isEmpty() && !SessionOrder.validId(id)) throw new IllegalArgumentException("invalid slot ID");
            result.add(id);
        }
        return new QuickSlots(result);
    }
    private static void checkSlot(int i) {
        if (i < 0 || i >= COUNT) throw new IndexOutOfBoundsException("slot");
    }
}
