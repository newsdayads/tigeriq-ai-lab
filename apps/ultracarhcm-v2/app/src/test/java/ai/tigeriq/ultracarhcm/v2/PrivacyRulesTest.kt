package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyRulesTest {
    @Test fun reportsPermissionStateWithoutInventingGrant() {
        assertEquals("Đã cấp", PrivacyRules.statusLabel(true))
        assertEquals("Chưa cấp", PrivacyRules.statusLabel(false))
    }

    @Test fun bluetoothConnectIsRuntimePermissionFromAndroid12() {
        assertFalse(PrivacyRules.bluetoothConnectRuntimeRequired(30))
        assertTrue(PrivacyRules.bluetoothConnectRuntimeRequired(31))
        assertTrue(PrivacyRules.bluetoothConnectRuntimeRequired(33))
    }
}
