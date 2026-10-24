package com.tigeriq.v44;
import java.util.*;
public final class V44LogicTest {
    static int ok = 0;
    static void yes(boolean b, String title) { if (!b) throw new AssertionError(title); ok++; }
    static void throwsBad(Runnable r, String title) {
        boolean bad=false; try {r.run();} catch (IllegalArgumentException | IndexOutOfBoundsException e) {bad=true;}
        yes(bad,title);
    }
    static List<String> order() { return Arrays.asList("id:α", "2", "3", "4"); }
    static ExactCardIndex idx(long v) {
        return new ExactCardIndex(v, Arrays.asList(
            new ExactCardIndex.Card("id:α", new ExactCardIndex.Rect(0,0,100,100), new ExactCardIndex.Rect(72,0,100,28)),
            new ExactCardIndex.Card("2", new ExactCardIndex.Rect(100,0,200,100), new ExactCardIndex.Rect(172,0,200,28)),
            new ExactCardIndex.Card("3", new ExactCardIndex.Rect(0,100,100,200), new ExactCardIndex.Rect(72,100,100,128)),
            new ExactCardIndex.Card("4", new ExactCardIndex.Rect(100,100,200,200), new ExactCardIndex.Rect(172,100,200,128))));
    }
    public static void main(String[] args) {
        yes(SessionOrder.validId("a:1"),"id");
        yes(!SessionOrder.validId(""),"empty id");
        yes(!SessionOrder.validId("x\ny"),"newline id");
        yes(!SessionOrder.validId(null),"null id");
        yes(!SessionOrder.validId(new String(new char[513]).replace('\0','x')),"max id");
        throwsBad(()->SessionOrder.checked(Arrays.asList("a","a")),"duplicate order");
        throwsBad(()->SessionOrder.checked(Arrays.asList("a",null)),"null order id");
        yes(SessionOrder.move(order(),"id:α","3").equals(Arrays.asList("2","3","id:α","4")),"move forward");
        yes(SessionOrder.move(order(),"3","id:α").equals(Arrays.asList("3","id:α","2","4")),"move backward");
        yes(SessionOrder.move(order(),"id:α","id:α").equals(order()),"same");
        yes(SessionOrder.move(order(),"missing","2").equals(order()),"missing source");
        yes(SessionOrder.move(order(),"2","missing").equals(order()),"missing dest");
        yes(SessionOrder.decode(SessionOrder.encode(order())).equals(order()),"order round trip unicode");
        yes(SessionOrder.decode("v44").isEmpty(),"empty order");
        throwsBad(()->SessionOrder.decode("v44|"),"invalid encoded");
        throwsBad(()->SessionOrder.decode("v43|YWJj"),"version fail");
        ExactCardIndex index=idx(101);
        yes("id:α".equals(index.sourceAtGrip(75,10)),"exact grip");
        yes(index.sourceAtGrip(10,10)==null,"not whole card");
        yes(index.sourceAtGrip(100,100)==null,"border gap");
        yes("2".equals(index.destinationAtCard(185,65)),"actual target");
        yes(index.destinationAtCard(200,50)==null,"outside never nearest");
        yes(index.destinationAtCard(Float.NaN,20)==null,"NaN fail closed");
        yes(index.destinationAtCard(Float.POSITIVE_INFINITY,20)==null,"infinity fail closed");
        throwsBad(()->new ExactCardIndex(0,Arrays.asList(
            new ExactCardIndex.Card("1",new ExactCardIndex.Rect(0,0,20,20),new ExactCardIndex.Rect(0,0,10,10)),
            new ExactCardIndex.Card("1",new ExactCardIndex.Rect(20,0,40,20),new ExactCardIndex.Rect(20,0,30,10)))),"duplicate cards");
        throwsBad(()->new ExactCardIndex.Card("1",new ExactCardIndex.Rect(0,0,20,20),new ExactCardIndex.Rect(18,0,30,10)),"grip outside");
        ExactCardIndex overlap=new ExactCardIndex(20,Arrays.asList(
            new ExactCardIndex.Card("A",new ExactCardIndex.Rect(0,0,100,100),new ExactCardIndex.Rect(0,0,40,40)),
            new ExactCardIndex.Card("B",new ExactCardIndex.Rect(50,0,150,100),new ExactCardIndex.Rect(55,0,95,40))));
        yes(overlap.destinationAtCard(60,60)==null,"overlap fail closed");
        yes(overlap.sourceAtGrip(60,20)!=null,"single grip in overlap");
        DragSession drag=new DragSession(index,75,10);
        yes(drag.started(),"start grip");
        yes("id:α".equals(drag.sourceId()),"source ID stable");
        yes(drag.release(index,185,65,order()).equals(Arrays.asList("2","id:α","3","4")),"adjacent move");
        yes(drag.release(index,50,150,order()).equals(Arrays.asList("2","3","id:α","4")),"real move");
        yes(drag.release(index,200,150,order()).equals(order()),"drop outside");
        yes(drag.release(idx(102),50,150,order()).equals(order()),"revision stale");
        yes(!new DragSession(index,15,15).started(),"cannot drag body");
        QuickSlots slots=QuickSlots.empty(); Set<String> known=new HashSet<String>(order());
        for (int i=0;i<5;i++) yes(slots.get(i).isEmpty(),"empty slot "+i);
        slots=slots.assign(0,"id:α",known).assign(4,"4",known);
        yes("id:α".equals(slots.get(0)),"quick slot id");
        yes("4".equals(slots.get(4)),"fifth slot");
        yes(QuickSlots.decode(slots.encode()).encode().equals(slots.encode()),"quick roundtrip");
        yes(slots.visibleId(0,known).equals("id:α"),"visible ID exists");
        yes(slots.visibleId(0,Collections.singleton("other")).isEmpty(),"missing hidden");
        final QuickSlots base=slots;
        throwsBad(()->base.assign(2,"invalid",known),"invalid assignment");
        throwsBad(()->base.assign(5,"4",known),"invalid index");
        throwsBad(()->QuickSlots.decode("v44slots|bad"),"wrong length");
        yes(QuickSlots.decode("").encode().equals(QuickSlots.empty().encode()),"no settings");
        yes(QuickSlots.decode(slots.encode()).get(2).isEmpty(),"empty preserved");
        System.out.println("V44_LOGIC_TESTS_PASS="+ok);
    }
}
