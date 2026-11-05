package com.tigeriq.v44;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.nio.charset.StandardCharsets;

/** Pure model; Android adapter must persist through existing Manager order key. */
public final class SessionOrder {
    private SessionOrder() {}
    public static boolean validId(String id) {
        if (id == null || id.isEmpty() || id.length() > 512) return false;
        for (int i=0;i<id.length();i++) if (Character.isISOControl(id.charAt(i))) return false;
        return true;
    }
    public static List<String> checked(List<String> ids) {
        if (ids == null) throw new IllegalArgumentException("null order");
        List<String> out = new ArrayList<String>();
        Set<String> seen = new HashSet<String>();
        for (String id:ids) {
            if (!validId(id) || !seen.add(id)) throw new IllegalArgumentException("invalid/duplicate ID");
            out.add(id);
        }
        return Collections.unmodifiableList(out);
    }
    public static List<String> move(List<String> order, String source, String destination) {
        List<String> out = new ArrayList<String>(checked(order));
        int a=out.indexOf(source), b=out.indexOf(destination);
        if (a < 0 || b < 0 || a == b) return Collections.unmodifiableList(out);
        out.remove(a); out.add(b,source);
        return Collections.unmodifiableList(out);
    }
    public static String encode(List<String> order) {
        StringBuilder b=new StringBuilder("v44");
        for(String id:checked(order))
            b.append('|').append(Base64.getUrlEncoder().withoutPadding().encodeToString(id.getBytes(StandardCharsets.UTF_8)));
        return b.toString();
    }
    public static List<String> decode(String raw) {
        if (raw == null || !raw.startsWith("v44")) throw new IllegalArgumentException("unknown format");
        String[] p=raw.split("\\|",-1);
        if (!"v44".equals(p[0])) throw new IllegalArgumentException("unknown version");
        List<String> ids=new ArrayList<String>();
        for(int i=1;i<p.length;i++) {
            if(p[i].isEmpty()) throw new IllegalArgumentException("empty encoded id");
            try { ids.add(new String(Base64.getUrlDecoder().decode(p[i]),StandardCharsets.UTF_8)); }
            catch (IllegalArgumentException e) { throw new IllegalArgumentException("invalid encoded id",e); }
        }
        return checked(ids);
    }
}
