package ai.tigeriq.ultracarhcm.v2

/** Samsung DeX lifecycle actions verified against Samsung's public DeX developer contract. */
internal object DexDockRules {
    const val ACTION_ENTER_DEX = "android.app.action.ENTER_KNOX_DESKTOP_MODE"
    const val ACTION_EXIT_DEX = "android.app.action.EXIT_KNOX_DESKTOP_MODE"

    fun isEnterAction(action: String?): Boolean = action == ACTION_ENTER_DEX
    fun isExitAction(action: String?): Boolean = action == ACTION_EXIT_DEX

    private fun hasExternalDisplay(displayId: Int?): Boolean =
        displayId != null && displayId > 0

    /** V2 auto-launch is limited to a real external display; standalone/unknown stays fail-closed. */
    fun shouldLaunchHome(action: String?, desktopActive: Boolean, displayId: Int?): Boolean =
        isEnterAction(action) && desktopActive && hasExternalDisplay(displayId)

    /**
     * The receiver is exported so Samsung/System can deliver the DeX broadcast.
     * Do not trust an EXIT action by itself: an untrusted sender must not be able
     * to tear down the overlay while external DeX is still active.
     */
    fun shouldStopOverlay(action: String?, desktopActive: Boolean, displayId: Int?): Boolean =
        isExitAction(action) && (!desktopActive || !hasExternalDisplay(displayId))

    const val MAX_ENTER_ATTEMPTS = 3

    /**
     * Samsung can announce DeX transition before DisplayManager/configuration converges.
     * Retry only the transient "state not ready" case; never retry a completed launch.
     */
    fun shouldRetryEnter(
        action: String?,
        attempt: Int,
        desktopActive: Boolean,
        displayId: Int?,
    ): Boolean =
        isEnterAction(action) &&
            attempt < MAX_ENTER_ATTEMPTS &&
            !shouldLaunchHome(action, desktopActive, displayId)

    fun retryDelayMs(nextAttempt: Int): Long = when (nextAttempt) {
        2 -> 350L
        else -> 900L
    }
}
