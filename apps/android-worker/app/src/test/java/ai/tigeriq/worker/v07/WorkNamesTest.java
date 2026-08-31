package ai.tigeriq.worker.v07;
import org.junit.Test;
import static org.junit.Assert.*;
public class WorkNamesTest {
    @Test public void sameJobProducesSameUniqueWorkName() { String a = WorkNames.execute("EMP-001", "IDEMP-A"); String b = WorkNames.execute("EMP-001", "IDEMP-A"); String other = WorkNames.execute("EMP-002", "IDEMP-A"); assertEquals(a, b); assertNotEquals(a, other); assertTrue(a.startsWith("tigeriq-v07-job-")); }
}
