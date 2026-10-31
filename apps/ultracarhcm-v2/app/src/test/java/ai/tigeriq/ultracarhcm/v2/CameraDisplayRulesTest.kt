package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraDisplayRulesTest {
    @Test fun togglesOnlyWhenVisibleCameraIsOnRequestedDisplay() {
        assertTrue(CameraDisplayRules.shouldToggleExisting(2, 2))
        assertFalse(CameraDisplayRules.shouldToggleExisting(0, 2))
    }

    @Test fun relaunchesInDedicatedTaskWhenExistingCameraIsOnAnotherDisplay() {
        assertTrue(CameraDisplayRules.needsDedicatedTask(0, 2))
        assertFalse(CameraDisplayRules.needsDedicatedTask(2, 2))
    }

    @Test fun doesNotReuseUnknownExistingDisplay() {
        assertFalse(CameraDisplayRules.shouldToggleExisting(null, 2))
        assertFalse(CameraDisplayRules.needsDedicatedTask(null, 2))
    }

    @Test fun unspecifiedFallbackIsAllowedOnlyWithoutExplicitDisplay() {
        assertTrue(CameraDisplayRules.allowUnspecifiedFallback(-1))
        assertFalse(CameraDisplayRules.allowUnspecifiedFallback(0))
        assertFalse(CameraDisplayRules.allowUnspecifiedFallback(2))
    }
}
