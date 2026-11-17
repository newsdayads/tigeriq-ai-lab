package ai.tigeriq.ultracarhcm.v2

import android.view.KeyEvent
import org.junit.Assert.*
import org.junit.Test

class RemoteKeyRulesTest {
    @Test fun safeKeysAllowMediaAndVolumeButNeverSystemNavigation() {
        assertTrue(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertTrue(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertTrue(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_HEADSETHOOK))
        assertTrue(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_VOLUME_UP))
        assertFalse(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_BACK))
        assertFalse(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_HOME))
        assertFalse(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_POWER))
        assertFalse(RemoteKeyRules.safeToMap(KeyEvent.KEYCODE_CALL))
    }

    @Test fun holdRulesHaveBoundsAndRejectStaleStuckPresses() {
        assertEquals(300L, RemoteKeyRules.holdDuration(0L))
        assertEquals(1800L, RemoteKeyRules.holdDuration(Long.MAX_VALUE))
        assertFalse(RemoteKeyRules.longPress(299, 300))
        assertTrue(RemoteKeyRules.longPress(300, 300))
        assertFalse(RemoteKeyRules.longPress(100, 500))
        assertTrue(RemoteKeyRules.longPress(500, 500))
        assertFalse(RemoteKeyRules.longPress(5000, 500))
    }

    @Test fun defaultIsSafeAndNoLongPressClaimFromSourceAlone() {
        assertEquals(500L, RemoteKeyRules.DEFAULT_HOLD_MS)
        assertEquals("Unmapped", RemoteKeyRules.keyLabel(KeyEvent.KEYCODE_HOME))
    }
}
