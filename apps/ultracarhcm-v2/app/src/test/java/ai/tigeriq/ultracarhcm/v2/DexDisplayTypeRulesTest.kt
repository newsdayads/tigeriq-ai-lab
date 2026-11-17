package ai.tigeriq.ultracarhcm.v2

import android.view.Display
import org.junit.Assert.*
import org.junit.Test

class DexDisplayTypeRulesTest {
    private fun eligible(
        id: Int,
        valid: Boolean = true,
        on: Boolean = true,
        nativeDesktop: Boolean = false,
    ) = DexDisplayGateRules.eligibleExternal(id, valid, on, nativeDesktop)

    @Test fun arbitraryAndroidSecondaryDisplayMustNotBecomeDex() {
        assertFalse(eligible(6))
        assertFalse(eligible(2))
        assertFalse(eligible(8))
        assertFalse(eligible(Display.DEFAULT_DISPLAY, nativeDesktop = true))
    }

    @Test fun realExternalDisplayNeedsVerifiedNativeDesktopState() {
        assertTrue(eligible(2, nativeDesktop = true))
        assertTrue(eligible(6, nativeDesktop = true))
        assertFalse(eligible(2, valid = false, nativeDesktop = true))
        assertFalse(eligible(2, on = false, nativeDesktop = true))
    }
}
