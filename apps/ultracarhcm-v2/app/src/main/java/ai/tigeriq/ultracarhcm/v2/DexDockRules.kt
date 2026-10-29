package ai.tigeriq.ultracarhcm.v2

/** Samsung DeX lifecycle actions verified against Samsung's public DeX developer contract. */
internal object DexDockRules {
    const val ACTION_ENTER_DEX = "android.app.action.ENTER_KNOX_DESKTOP_MODE"
    const val ACTION_EXIT_DEX = "android.app.action.EXIT_KNOX_DESKTOP_MODE"

    fun isEnterAction(action: String?): Boolean = action == ACTION_ENTER_DEX
    fun isExitAction(action: String?): Boolean = action == ACTION_EXIT_DEX

    /** V2 auto-launch is limited to a real external display; standalone/unknown stays fail-closed. */
    fun shouldLaunchHome(action: String?, desktopActive: Boolean, displayId: Int?): Boolean =
        isEnterAction(action) && desktopActive && displayId != null && displayId > 0
}
