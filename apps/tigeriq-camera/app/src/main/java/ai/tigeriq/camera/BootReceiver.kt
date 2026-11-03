package ai.tigeriq.camera

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.i("TigerIQ_Boot", "Device boot completed -> Starting FloatingCameraService Power Watcher")
            CameraOnlineBridge.schedule(context)
            val settings = CameraSettings(context)
            if (settings.isReverseAutoStart || settings.isFloatingEnabled) {
                FloatingCameraService.start(context)
            }
        }
    }
}
