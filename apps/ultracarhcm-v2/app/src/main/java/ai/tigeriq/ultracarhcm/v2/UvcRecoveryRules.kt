package ai.tigeriq.ultracarhcm.v2

internal object UvcRecoveryRules {
    const val MAX_AUTOMATIC_ATTEMPTS = 2
    const val RETRY_DELAY_MS = 750L

    fun shouldSchedule(requested: Boolean, targetCleared: Boolean, attemptsUsed: Int): Boolean =
        requested && targetCleared && attemptsUsed < MAX_AUTOMATIC_ATTEMPTS

    fun nextAttempt(attemptsUsed: Int): Int =
        (attemptsUsed + 1).coerceAtMost(MAX_AUTOMATIC_ATTEMPTS)

    fun exhausted(attemptsUsed: Int): Boolean =
        attemptsUsed >= MAX_AUTOMATIC_ATTEMPTS

    fun shouldCancelRecoveryForDetach(recoveryDeviceId: Int?, detachedDeviceId: Int): Boolean =
        recoveryDeviceId != null && recoveryDeviceId == detachedDeviceId
}
