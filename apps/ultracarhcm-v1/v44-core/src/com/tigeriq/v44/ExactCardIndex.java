package com.tigeriq.v44;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
/** Screen-space card/grip registry. No accessibility-title matching or nearest-card fallback. */
public final class ExactCardIndex {
    public static final class Rect {
        public final int left, top, right, bottom;
        public Rect(int left, int top, int right, int bottom) {
            if (right <= left || bottom <= top) throw new IllegalArgumentException("invalid rectangle");
            this.left = left; this.top = top; this.right = right; this.bottom = bottom;
        }
        public boolean contains(float x, float y) {
            return x >= left && x < right && y >= top && y < bottom;
        }
        public boolean contains(Rect other) {
            return other.left >= left && other.top >= top && other.right <= right && other.bottom <= bottom;
        }
    }
    public static final class Card {
        public final String sessionId;
        public final Rect card;
        public final Rect grip;
        public Card(String sessionId, Rect card, Rect grip) {
            if (!SessionOrder.validId(sessionId) || card == null || grip == null || !card.contains(grip))
                throw new IllegalArgumentException("invalid card/grip/id");
            this.sessionId = sessionId; this.card = card; this.grip = grip;
        }
    }
    public final long revision;
    private final List<Card> cards;
    public ExactCardIndex(long revision, List<Card> source) {
        if (source == null) throw new IllegalArgumentException("no cards");
        Set<String> ids = new HashSet<String>();
        List<Card> copy = new ArrayList<Card>();
        for (Card c : source) {
            if (c == null || !ids.add(c.sessionId)) throw new IllegalArgumentException("duplicate/null session id");
            copy.add(c);
        }
        this.revision = revision;
        cards = Collections.unmodifiableList(copy);
    }
    /** Pointer down must be inside the unique dedicated grip. */
    public String sourceAtGrip(float rawX, float rawY) { return hit(rawX, rawY, true); }
    /** Drop must be inside exactly one actual card. */
    public String destinationAtCard(float rawX, float rawY) { return hit(rawX, rawY, false); }
    private String hit(float x, float y, boolean grip) {
        if (Float.isNaN(x) || Float.isNaN(y) || Float.isInfinite(x) || Float.isInfinite(y)) return null;
        String found = null;
        for (Card c : cards) {
            if ((grip ? c.grip : c.card).contains(x, y)) {
                if (found != null) return null; // ambiguous overlap, fail closed
                found = c.sessionId;
            }
        }
        return found;
    }
    public boolean has(String id) {
        for (Card c : cards) if (c.sessionId.equals(id)) return true;
        return false;
    }
}
