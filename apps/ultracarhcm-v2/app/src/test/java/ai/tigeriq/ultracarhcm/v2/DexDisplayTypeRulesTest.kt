package ai.tigeriq.ultracarhcm.v2

import android.view.Display
import org.junit.Assert.*
import org.junit.Test

class DexDisplayTypeRulesTest {
    private fun eligible(
        id: Int,
        type: Int,
        valid: Boolean = true,
        on: Boolean = true,
        nativeDesktop: Boolean = false,
    ) = DexDisplayTypeRules.eligibleExternal(id, type, valid, on, nativeDesktop)

    @Test fun simulatedDeveloperOverlayMustNeverBecomeDex() {
        assertFalse(eligible(6, Display.TYPE_OVERLAY))
        assertFalse(eligible(6, Display.TYPE_OVERLAY, nativeDesktop = true))
    }

    @Test fun arbitraryAppVirtualDisplayRequiresActualNativeSamsungDesktop() {
        assertFalse(eligible(8, Display.TYPE_VIRTUAL))
        assertTrue(eligible(8, Display.TYPE_VIRTUAL, nativeDesktop = true))
    }

    @Test fun trueExternalDisplayCandidatesStillWork() {
        assertTrue(eligible(2, Display.TYPE_HDMI))
        assertTrue(eligible(3, Display.TYPE_WIFI))
        assertFalse(eligible(Display.DEFAULT_DISPLAY, Display.TYPE_BUILT_IN))
        assertFalse(eligible(2, Display.TYPE_HDMI, valid = false))
        assertFalse(eligible(2, Display.TYPE_HDMI, on = false))
    }
}
