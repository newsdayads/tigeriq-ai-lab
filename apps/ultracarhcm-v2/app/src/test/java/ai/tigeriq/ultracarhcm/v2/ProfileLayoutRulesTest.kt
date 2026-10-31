package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileLayoutRulesTest {
    @Test fun compactPhoneUsesOneColumn() {
        assertEquals(1, ProfileLayoutRules.columnsForWidthDp(360))
        assertEquals(1, ProfileLayoutRules.columnsForWidthDp(599))
    }

    @Test fun landscapeAndTabletUseTwoColumns() {
        assertEquals(2, ProfileLayoutRules.columnsForWidthDp(600))
        assertEquals(2, ProfileLayoutRules.columnsForWidthDp(959))
    }

    @Test fun wideDexUsesThreeColumns() {
        assertEquals(3, ProfileLayoutRules.columnsForWidthDp(960))
        assertEquals(3, ProfileLayoutRules.columnsForWidthDp(1440))
    }
}
