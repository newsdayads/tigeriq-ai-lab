package com.tigeriq.v44;
import java.util.*;

/** Deterministic model tests; NOT Compose/DeX acceptance. */
public final class V44LogicTest {
    static int ok=0;
    static void yes(boolean b,String why){if(!b)throw new AssertionError(why);ok++;}
    static void throwsBad(Runnable f,String why){
        boolean failed=false;try{f.run();}catch(IllegalArgumentException|IndexOutOfBoundsException e){failed=true;}
        yes(failed,why);
    }
    static List<String> order(){return Arrays.asList("id:α","2","3","4");}
    static ExactCardIndex idx(long revision){
        return new ExactCardIndex(revision,Arrays.asList(
            new ExactCardIndex.Card("id:α",new ExactCardIndex.Rect(0,0,100,100),new ExactCardIndex.Rect(72,0,100,28)),
            new ExactCardIndex.Card("2",new ExactCardIndex.Rect(100,0,200,100),new ExactCardIndex.Rect(172,0,200,28)),
            new ExactCardIndex.Card("3",new ExactCardIndex.Rect(0,100,100,200),new ExactCardIndex.Rect(72,100,100,128)),
            new ExactCardIndex.Card("4",new ExactCardIndex.Rect(100,100,200,200),new ExactCardIndex.Rect(172,100,200,128))));
    }
    public static void main(String[] args){
        yes(SessionOrder.validId("a:1"),"valid");
        yes(!SessionOrder.validId(""),"empty");
        yes(!SessionOrder.validId("x\ny"),"newline");
        yes(!SessionOrder.validId(null),"null");
        yes(!SessionOrder.validId(new String(new char[513]).replace((char)0,'x')),"long");
        throwsBad(()->SessionOrder.checked(Arrays.asList("a","a")),"duplicate");
        throwsBad(()->SessionOrder.checked(Arrays.asList("a",null)),"null item");
        yes(SessionOrder.move(order(),"id:α","3").equals(Arrays.asList("2","3","id:α","4")),"forward");
        yes(SessionOrder.move(order(),"3","id:α").equals(Arrays.asList("3","id:α","2","4")),"back");
        yes(SessionOrder.move(order(),"id:α","id:α").equals(order()),"same");
        yes(SessionOrder.move(order(),"missing","2").equals(order()),"missing source");
        yes(SessionOrder.move(order(),"2","missing").equals(order()),"missing target");
        yes(SessionOrder.decode(SessionOrder.encode(order())).equals(order()),"unicode round trip");
        yes(SessionOrder.decode("v44").isEmpty(),"empty order");
        throwsBad(()->SessionOrder.decode("v44|"),"invalid order");
        throwsBad(()->SessionOrder.decode("v43|YWJj"),"version guard");
        ExactCardIndex index=idx(101);
        yes("id:α".equals(index.sourceAtGrip(75,10)),"source grip");
        yes(index.sourceAtGrip(10,10)==null,"only grip");
        yes(index.sourceAtGrip(100,100)==null,"gap");
        yes("2".equals(index.destinationAtCard(185,65)),"dest");
        yes(index.destinationAtCard(200,50)==null,"never nearest");
        yes(index.destinationAtCard(Float.NaN,20)==null,"nan");
        yes(index.destinationAtCard(Float.POSITIVE_INFINITY,20)==null,"inf");
        throwsBad(()->new ExactCardIndex(0,Arrays.asList(
            new ExactCardIndex.Card("1",new ExactCardIndex.Rect(0,0,20,20),new ExactCardIndex.Rect(0,0,10,10)),
            new ExactCardIndex.Card("1",new ExactCardIndex.Rect(20,0,40,20),new ExactCardIndex.Rect(20,0,30,10)))),"dup cards");
        throwsBad(()->new ExactCardIndex.Card("1",new ExactCardIndex.Rect(0,0,20,20),new ExactCardIndex.Rect(18,0,30,10)),"grip outside");
        ExactCardIndex overlap=new ExactCardIndex(20,Arrays.asList(
            new ExactCardIndex.Card("A",new ExactCardIndex.Rect(0,0,100,100),new ExactCardIndex.Rect(0,0,40,40)),
            new ExactCardIndex.Card("B",new ExactCardIndex.Rect(50,0,150,100),new ExactCardIndex.Rect(55,0,95,40))));
        yes(overlap.destinationAtCard(60,60)==null,"overlap rejected");
        yes(overlap.sourceAtGrip(60,20)!=null,"unique grip");
        DragSession drag=new DragSession(index,75,10);
        yes(drag.started(),"start");
        yes("id:α".equals(drag.sourceId()),"stable source");
        yes(drag.release(index,185,65,order()).equals(Arrays.asList("2","id:α","3","4")),"drop2");
        yes(drag.release(index,50,150,order()).equals(Arrays.asList("2","3","id:α","4")),"drop3");
        yes(drag.release(index,200,150,order()).equals(order()),"outside drop");
        yes(drag.release(idx(102),50,150,order()).equals(order()),"revision guard");
        yes(!new DragSession(index,15,15).started(),"body no drag");
        QuickSlots slots=QuickSlots.empty();
        Set<String> known=new HashSet<String>(order());
        for(int i=0;i<5;i++)yes(slots.get(i).isEmpty(),"empty"+i);
        slots=slots.assign(0,"id:α",known).assign(4,"4",known);
        yes("id:α".equals(slots.get(0)),"slot1");
        yes("4".equals(slots.get(4)),"slot5");
        yes(QuickSlots.decode(slots.encode()).encode().equals(slots.encode()),"slot round trip");
        yes(slots.visibleId(0,known).equals("id:α"),"known visible");
        yes(slots.visibleId(0,Collections.singleton("other")).isEmpty(),"orphan hidden");
        final QuickSlots base=slots;
        throwsBad(()->base.assign(2,"invalid",known),"reject invalid");
        throwsBad(()->base.assign(5,"4",known),"invalid index");
        throwsBad(()->QuickSlots.decode("v44slots|bad"),"invalid payload");
        yes(QuickSlots.decode("").encode().equals(QuickSlots.empty().encode()),"empty");
        yes(QuickSlots.decode(slots.encode()).get(2).isEmpty(),"free slot");
        System.out.println("V44_LOGIC_TESTS_PASS="+ok);
    }
}
