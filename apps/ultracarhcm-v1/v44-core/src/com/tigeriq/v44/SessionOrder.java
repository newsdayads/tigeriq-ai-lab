package com.tigeriq.v44;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.nio.charset.StandardCharsets;
/** Pure model; runtime adapter must use the existing Manager.shift(id, index) persistence. */
public final class SessionOrder {
    private SessionOrder() {}
    public static boolean validId(String id) {
        if (id == null || id.length() == 0 || id.length() > 512) return false;
        for (int i = 0; i < id.length(); i++) if (Character.isISOControl(id.charAt(i))) return false;
        return true;
    }
    public static List<String> checked(List<String> ids) {
        if (ids == null) throw new IllegalArgumentException("null order");
        List<String> result = new ArrayList<String>();
        Set<String> unique = new HashSet<String>();
        for (String id : ids) {
            if (!validId(id) || !unique.add(id)) throw new IllegalArgumentException("invalid/duplicate ID");
            result.add(id);
        }
        return Collections.unmodifiableList(result);
    }
    /** Remove source, insert at target's original index, keyed by session ID. */
    public static List<String> move(List<String> order, String source, String destination) {
        List<String> result = new ArrayList<String>(checked(order));
        int a = result.indexOf(source), b = result.indexOf(destination);
        if (a < 0 || b < 0 || a == b) return Collections.unmodifiableList(result);
        result.remove(a);
        result.add(b, source);
        return Collections.unmodifiableList(result);
    }
    public static String encode(List<String> order) {
        List<String> ids = checked(order);
        StringBuilder out = new StringBuilder("v44");
        for (String id : ids) out.append('|').append(Base64.getUrlEncoder().withoutPadding()
            .encodeToString(id.getBytes(StandardCharsets.UTF_8)));
        return out.toString();
    }
    public static List<String> decode(String raw) {
        if (raw == null || !raw.startsWith("v44")) throw new IllegalArgumentException("unknown format");
        String[] parts = raw.split("\\|", -1);
        if (!"v44".equals(parts[0])) throw new IllegalArgumentException("unknown version");
        List<String> result = new ArrayList<String>();
        for (int i = 1; i < parts.length; i++) {
            if (parts[i].isEmpty()) throw new IllegalArgumentException("empty encoded id");
            try {
                result.add(new String(Base64.getUrlDecoder().decode(parts[i]), StandardCharsets.UTF_8));
            } catch (IllegalArgumentException e) { throw new IllegalArgumentException("invalid encoded id", e); }
        }
        return checked(result);
    }
}
