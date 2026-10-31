package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DexDockRulesTest {
    @Test fun recognizesSamsungDexEnterAndExitActions() {
        assertTrue(DexDockRules.isEnterAction("android.app.action.ENTER_KNOX_DESKTOP_MODE"))
        assertTrue(DexDockRules.isExitAction("android.app.action.EXIT_KNOX_DESKTOP_MODE"))
        assertFalse(DexDockRules.isEnterAction(DexDockRules.ACTION_EXIT_DEX))
        assertFalse(DexDockRules.isExitAction(DexDockRules.ACTION_ENTER_DEX))
    }

    @Test fun launchesOnlyForEnterOnRealExternalDisplay() {
        assertTrue(DexDockRules.shouldLaunchHome(DexDockRules.ACTION_ENTER_DEX, true, 2))
        assertFalse(DexDockRules.shouldLaunchHome(DexDockRules.ACTION_ENTER_DEX, true, 0))
    }

    @Test fun refusesLaunchWhenDesktopStateIsNotActive() {
        assertFalse(DexDockRules.shouldLaunchHome(DexDockRules.ACTION_ENTER_DEX, false, 2))
    }

    @Test fun refusesUnknownMissingOrExitEvents() {
        assertFalse(DexDockRules.shouldLaunchHome(null, true, 2))
        assertFalse(DexDockRules.shouldLaunchHome("other", true, 2))
        assertFalse(DexDockRules.shouldLaunchHome(DexDockRules.ACTION_EXIT_DEX, true, 2))
        assertFalse(DexDockRules.shouldLaunchHome(DexDockRules.ACTION_ENTER_DEX, true, null))
    }

    @Test fun stopsOverlayOnlyAfterRealExternalDexIsGone() {
        assertTrue(DexDockRules.shouldStopOverlay(DexDockRules.ACTION_EXIT_DEX, false, null))
        assertTrue(DexDockRules.shouldStopOverlay(DexDockRules.ACTION_EXIT_DEX, true, null))
        assertFalse(DexDockRules.shouldStopOverlay(DexDockRules.ACTION_EXIT_DEX, true, 2))
    }

    @Test fun ignoresSpoofedOrWrongExitWhileExternalDexIsActive() {
        assertFalse(DexDockRules.shouldStopOverlay(null, false, null))
        assertFalse(DexDockRules.shouldStopOverlay("other", false, null))
        assertFalse(DexDockRules.shouldStopOverlay(DexDockRules.ACTION_ENTER_DEX, false, null))
        assertFalse(DexDockRules.shouldStopOverlay(DexDockRules.ACTION_EXIT_DEX, true, 3))
    }

    @Test fun retriesEnterOnlyWhileStateIsNotReadyAndBudgetRemains() {
        assertTrue(DexDockRules.shouldRetryEnter(DexDockRules.ACTION_ENTER_DEX, 1, false, null))
        assertTrue(DexDockRules.shouldRetryEnter(DexDockRules.ACTION_ENTER_DEX, 2, true, null))
        assertFalse(DexDockRules.shouldRetryEnter(DexDockRules.ACTION_ENTER_DEX, 3, false, null))
        assertFalse(DexDockRules.shouldRetryEnter(DexDockRules.ACTION_ENTER_DEX, 1, true, 2))
        assertFalse(DexDockRules.shouldRetryEnter(DexDockRules.ACTION_EXIT_DEX, 1, false, null))
    }

    @Test fun usesBoundedShortRetryDelays() {
        assertEquals(3, DexDockRules.MAX_ENTER_ATTEMPTS)
        assertEquals(350L, DexDockRules.retryDelayMs(2))
        assertEquals(900L, DexDockRules.retryDelayMs(3))
    }
}
