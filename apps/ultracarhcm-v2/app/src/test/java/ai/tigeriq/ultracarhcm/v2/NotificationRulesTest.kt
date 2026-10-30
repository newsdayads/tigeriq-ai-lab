package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationRulesTest {
    @Test fun replacesOnlyWithStrictlyNewerVersion() {
        assertTrue(NotificationRules.shouldReplaceNotice(9L, 10L))
        assertFalse(NotificationRules.shouldReplaceNotice(10L, 10L))
        assertFalse(NotificationRules.shouldReplaceNotice(11L, 10L))
        assertFalse(NotificationRules.shouldReplaceNotice(0L, 0L))
    }


    @Test fun resolvesOnlyNoticesAtOrBelowInstalledVersion() {
        assertTrue(NotificationRules.isResolvedNotice(10L, 10L))
        assertTrue(NotificationRules.isResolvedNotice(11L, 10L))
        assertFalse(NotificationRules.isResolvedNotice(9L, 10L))
        assertFalse(NotificationRules.isResolvedNotice(0L, 10L))
        assertFalse(NotificationRules.isResolvedNotice(10L, 0L))
    }

    @Test fun unreadCountRequiresExistingUnreadNotice() {
        assertEquals(1, NotificationRules.unreadCount(10L, false))
        assertEquals(0, NotificationRules.unreadCount(10L, true))
        assertEquals(0, NotificationRules.unreadCount(0L, false))
    }

    @Test fun normalizesVersionName() {
        assertEquals("2.0.0-test", NotificationRules.normalizeVersionName(" 2.0.0-test "))
        assertEquals(120, NotificationRules.normalizeVersionName("x".repeat(150)).length)
    }

    @Test fun boundsReleaseNotes() {
        assertEquals("notes", NotificationRules.normalizeReleaseNotes(" notes "))
        assertEquals(4_000, NotificationRules.normalizeReleaseNotes("x".repeat(5_000)).length)
    }
}
