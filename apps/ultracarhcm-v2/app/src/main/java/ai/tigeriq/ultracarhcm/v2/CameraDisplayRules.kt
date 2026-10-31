package ai.tigeriq.ultracarhcm.v2

internal object CameraDisplayRules {
    fun shouldToggleExisting(existingDisplayId: Int?, requestedDisplayId: Int): Boolean =
        existingDisplayId != null &&
            requestedDisplayId >= 0 &&
            existingDisplayId == requestedDisplayId

    fun needsDedicatedTask(existingDisplayId: Int?, requestedDisplayId: Int): Boolean =
        existingDisplayId != null &&
            requestedDisplayId >= 0 &&
            existingDisplayId != requestedDisplayId

    fun allowUnspecifiedFallback(requestedDisplayId: Int): Boolean =
        requestedDisplayId < 0
}
