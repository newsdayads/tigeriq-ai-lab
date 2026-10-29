package ai.tigeriq.ultracarhcm.v2

import android.app.ActivityOptions
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
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
            DexDockRules.isEnterAction(intent.action) -> {
                val pendingResult = goAsync()
                launchV2HomeOnDexWithRetry(
                    context.applicationContext,
                    intent.action,
                    attempt = 1,
                    pendingResult = pendingResult,
                )
            }
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

    private fun launchV2HomeOnDexWithRetry(
        context: Context,
        action: String?,
        attempt: Int,
        pendingResult: PendingResult,
    ) {
        val desktopActive = DexUtils.isDesktop(context)
        val display = DexUtils.resolveDisplay(context, Display.DEFAULT_DISPLAY)
        val displayId = display?.displayId

        if (!DexDockRules.shouldLaunchHome(action, desktopActive, displayId)) {
            if (DexDockRules.shouldRetryEnter(action, attempt, desktopActive, displayId)) {
                val nextAttempt = attempt + 1
                val delayMs = DexDockRules.retryDelayMs(nextAttempt)
                Log.i(
                    TAG,
                    "DeX enter state not ready: attempt=$attempt desktop=$desktopActive " +
                        "display=$displayId; retry=$nextAttempt in $delayMs ms",
                )
                MAIN_HANDLER.postDelayed(
                    {
                        launchV2HomeOnDexWithRetry(
                            context,
                            action,
                            attempt = nextAttempt,
                            pendingResult = pendingResult,
                        )
                    },
                    delayMs,
                )
                return
            }

            Log.i(
                TAG,
                "DeX enter ignored after attempt=$attempt: desktop=$desktopActive display=$displayId",
            )
            pendingResult.finish()
            return
        }

        val home = Intent(context, HomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        try {
            val options = ActivityOptions.makeBasic().apply {
                launchDisplayId = displayId!!
            }
            context.startActivity(home, options.toBundle())
            Log.i(TAG, "Requested V2 Home on DeX display=$displayId attempt=$attempt")
        } catch (error: Throwable) {
            // Platform launch failure is terminal for this broadcast; do not retry a rejected launch.
            Log.w(TAG, "DeX Home launch blocked by platform", error)
        } finally {
            pendingResult.finish()
        }
    }

    private companion object {
        const val TAG = "UltraCarV2DexDock"
        val MAIN_HANDLER = Handler(Looper.getMainLooper())
    }
}
