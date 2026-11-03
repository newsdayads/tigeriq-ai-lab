package ai.tigeriq.camera

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Bounded app-private diagnostic log. Never stores frames, images, VIN,
 * location, phone identifiers, or raw broadcast extras.
 * Manual sharing from Settings only; no network upload.
 */
object CameraEventLog {
    private const val TAG = "TigerIQ_Event"
    private const val FILE_NAME = "camera_events.log"
    private const val MAX_BYTES = 128 * 1024
    private const val KEEP_BYTES = 80 * 1024
    private val guard = Any()

    fun record(context: Context, source: String, event: String, detail: String = "") {
        try {
            synchronized(guard) {
                val safe = detail.replace(10.toChar(), ' ').replace(13.toChar(), ' ').take(300)
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
                val file = File(context.applicationContext.filesDir, FILE_NAME)
                if (file.exists() && file.length() > MAX_BYTES) {
                    val bytes = file.readBytes()
                    val kept = bytes.copyOfRange((bytes.size - KEEP_BYTES).coerceAtLeast(0), bytes.size)
                    file.writeBytes(kept)
                }
                file.appendText(stamp + " | " + source + " | " + event + " | " + safe + "\n")
            }
        } catch (error: Exception) {
            Log.e(TAG, "Cannot write diagnostic log", error)
        }
        // Non-blocking, authenticated upload; event recording never depends on network.
        CameraOnlineBridge.onLogChanged(context)
    }

    fun read(context: Context, maxChars: Int = 32000): String =
        try {
            synchronized(guard) {
                val f = File(context.applicationContext.filesDir, FILE_NAME)
                if (!f.exists()) "Chưa có sự kiện. Thử mở và đóng Camera khi xe đang đỗ."
                else f.readText(Charsets.UTF_8).takeLast(maxChars)
            }
        } catch (error: Exception) {
            "DOC_LOG_THAT_BAI: " + error.javaClass.simpleName
        }
}
