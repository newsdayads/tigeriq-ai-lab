package com.tigeriq.v44;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Exact screen-space card/grip registry. No nearest-card or title fallback. */
public final class ExactCardIndex {
    public static final class Rect {
        public final int left, top, right, bottom;
        public Rect(int left, int top, int right, int bottom) {
            if (right <= left || bottom <= top) throw new IllegalArgumentException("invalid rectangle");
            this.left = left; this.top = top; this.right = right; this.bottom = bottom;
        }
        public boolean contains(float x, float y) { return x >= left && x < right && y >= top && y < bottom; }
        public boolean contains(Rect o) { return o.left >= left && o.top >= top && o.right <= right && o.bottom <= bottom; }
    }
    public static final class Card {
        public final String sessionId;
        public final Rect card, grip;
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
    public String sourceAtGrip(float x, float y) { return hit(x,y,true); }
    public String destinationAtCard(float x, float y) { return hit(x,y,false); }
    private String hit(float x, float y, boolean grip) {
        if (Float.isNaN(x) || Float.isNaN(y) || Float.isInfinite(x) || Float.isInfinite(y)) return null;
        String found = null;
        for (Card c : cards) {
            if ((grip ? c.grip : c.card).contains(x,y)) {
                if (found != null) return null;
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
