package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceRulesTest {
    @Test fun recognizesOnlyImageAndVideoMimeFamilies() {
        assertEquals(AppearanceRules.KIND_IMAGE, AppearanceRules.kindForMime("image/png"))
        assertEquals(AppearanceRules.KIND_VIDEO, AppearanceRules.kindForMime("video/mp4"))
        assertNull(AppearanceRules.kindForMime("text/plain"))
        assertNull(AppearanceRules.kindForMime(null))
    }

    @Test fun validatesStoredBackgroundKinds() {
        assertTrue(AppearanceRules.isSupportedKind(AppearanceRules.KIND_IMAGE))
        assertTrue(AppearanceRules.isSupportedKind(AppearanceRules.KIND_VIDEO))
        assertFalse(AppearanceRules.isSupportedKind("audio"))
    }

    @Test fun exposesVerifiedDayNightLabelsOnly() {
        assertEquals("Ban ngày", AppearanceRules.modeLabel(false))
        assertEquals("Ban đêm", AppearanceRules.modeLabel(true))
    }
}
