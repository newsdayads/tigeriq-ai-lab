package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UvcRecoveryRulesTest {
    @Test fun schedulesOnlyForRequestedSessionWithClearedTargetAndBudget() {
        assertTrue(UvcRecoveryRules.shouldSchedule(true, true, 0))
        assertFalse(UvcRecoveryRules.shouldSchedule(false, true, 0))
        assertFalse(UvcRecoveryRules.shouldSchedule(true, false, 0))
    }

    @Test fun automaticRecoveryStopsAtTwoAttempts() {
        assertTrue(UvcRecoveryRules.shouldSchedule(true, true, 1))
        assertFalse(UvcRecoveryRules.shouldSchedule(true, true, 2))
        assertTrue(UvcRecoveryRules.exhausted(2))
    }

    @Test fun nextAttemptIsBounded() {
        assertEquals(1, UvcRecoveryRules.nextAttempt(0))
        assertEquals(2, UvcRecoveryRules.nextAttempt(1))
        assertEquals(2, UvcRecoveryRules.nextAttempt(2))
    }

    @Test fun cancelsRecoveryOnlyWhenTheRecoveringDeviceActuallyDetaches() {
        assertTrue(UvcRecoveryRules.shouldCancelRecoveryForDetach(41, 41))
        assertFalse(UvcRecoveryRules.shouldCancelRecoveryForDetach(41, 42))
        assertFalse(UvcRecoveryRules.shouldCancelRecoveryForDetach(null, 41))
    }

    @Test fun retryDelayIsShortAndDeterministic() {
        assertEquals(750L, UvcRecoveryRules.RETRY_DELAY_MS)
    }
}
