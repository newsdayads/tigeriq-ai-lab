package com.tigeriq.v44;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.nio.charset.StandardCharsets;

/** Five stable-ID slots, independent of display name, order or current index. */
public final class QuickSlots {
    public static final int COUNT=5;
    private final List<String> slots;
    private QuickSlots(List<String> values) { slots=Collections.unmodifiableList(values); }
    public static QuickSlots empty() {
        List<String> x=new ArrayList<String>();
        for(int i=0;i<COUNT;i++) x.add("");
        return new QuickSlots(x);
    }
    public String get(int i) { check(i); return slots.get(i); }
    public QuickSlots assign(int i,String id,Set<String> known) {
        check(i);
        if(known==null) throw new IllegalArgumentException("ids required");
        if(id==null) id="";
        if(!id.isEmpty() && (!SessionOrder.validId(id) || !known.contains(id)))
            throw new IllegalArgumentException("unknown session ID");
        List<String> x=new ArrayList<String>(slots);x.set(i,id);
        return new QuickSlots(x);
    }
    public String visibleId(int i,Set<String> known) {
        String id=get(i); return known!=null && known.contains(id) ? id:"";
    }
    public String encode() {
        StringBuilder out=new StringBuilder("v44slots");
        for(String id:slots) {
            out.append('|');
            if(!id.isEmpty())
                out.append(Base64.getUrlEncoder().withoutPadding().encodeToString(id.getBytes(StandardCharsets.UTF_8)));
        }
        return out.toString();
    }
    public static QuickSlots decode(String raw) {
        if(raw==null||raw.isEmpty())return empty();
        String[] p=raw.split("\\|",-1);
        if(p.length!=COUNT+1||!"v44slots".equals(p[0]))throw new IllegalArgumentException("invalid slots format");
        List<String> out=new ArrayList<String>();
        for(int i=1;i<p.length;i++) {
            String id;
            try{id=p[i].isEmpty()?"":new String(Base64.getUrlDecoder().decode(p[i]),StandardCharsets.UTF_8);}
            catch(IllegalArgumentException e){throw new IllegalArgumentException("invalid slot encoding",e);}
            if(!id.isEmpty()&&!SessionOrder.validId(id))throw new IllegalArgumentException("invalid slot ID");
            out.add(id);
        }
        return new QuickSlots(out);
    }
    private static void check(int i) { if(i<0||i>=COUNT)throw new IndexOutOfBoundsException("slot"); }
}
