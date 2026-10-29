package ai.tigeriq.ultracarhcm.v2

import android.app.ActivityOptions
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.Display

/**
 * Samsung DeX enter/exit bridge.
 *
 * Source support only: real Samsung DeX delivery, background-launch behavior and display routing
 * still require authorized device QA. V1 package/data are never touched.
 */
class DexDockReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when {
            DexDockRules.isEnterAction(intent.action) -> launchV2HomeOnDex(context, intent.action)
            DexDockRules.isExitAction(intent.action) -> stopOverlayIfDexGone(context, intent.action)
        }
    }

    private fun stopOverlayIfDexGone(context: Context, action: String?) {
        val desktopActive = DexUtils.isDesktop(context)
        val displayId = DexUtils.resolveDisplay(context, Display.DEFAULT_DISPLAY)?.displayId
        if (!DexDockRules.shouldStopOverlay(action, desktopActive, displayId)) {
            Log.i(TAG, "DeX exit ignored: desktop=$desktopActive display=$displayId")
            return
        }
        runCatching { context.stopService(Intent(context, OverlayService::class.java)) }
            .onFailure { Log.w(TAG, "Unable to stop V2 overlay after DeX exit", it) }
    }

    private fun launchV2HomeOnDex(context: Context, action: String?) {
        val desktopActive = DexUtils.isDesktop(context)
        val display = DexUtils.resolveDisplay(context, Display.DEFAULT_DISPLAY)
        val displayId = display?.displayId
        if (!DexDockRules.shouldLaunchHome(action, desktopActive, displayId)) {
            Log.i(TAG, "DeX enter ignored: desktop=$desktopActive display=$displayId")
            return
        }

        val home = Intent(context, HomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        try {
            val options = ActivityOptions.makeBasic().apply {
                launchDisplayId = displayId!!
            }
            context.startActivity(home, options.toBundle())
            Log.i(TAG, "Requested V2 Home on DeX display=$displayId")
        } catch (error: Throwable) {
            // Background activity launch can be OEM/OS restricted. Fail closed; device QA decides acceptance.
            Log.w(TAG, "DeX Home launch blocked by platform", error)
        }
    }

    private companion object {
        const val TAG = "UltraCarV2DexDock"
    }
}
