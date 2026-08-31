package ai.tigeriq.worker.v07;

import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class DeviceKeyStoreTest {
    @Test
    public void aliasDoesNotCollapseColonAndUnderscore() {
        String first = DeviceKeyStore.aliasFor("EMP:001", "DEV:001");
        String second = DeviceKeyStore.aliasFor("EMP_001", "DEV:001");
        assertNotEquals(first, second);
    }

    @Test
    public void aliasFramesEmployeeAndDeviceBoundaries() {
        String first = DeviceKeyStore.aliasFor("EMP:001", "DEV_001");
        String second = DeviceKeyStore.aliasFor("EMP_001", "DEV:001");
        assertNotEquals(first, second);
        assertTrue(first.startsWith("tigeriq.v07."));
        assertTrue(second.startsWith("tigeriq.v07."));
    }
}
