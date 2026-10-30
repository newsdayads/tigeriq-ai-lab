package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class UpdateActivity : ComponentActivity() {
    private lateinit var status: TextView
    private lateinit var checkButton: Button
    private lateinit var downloadButton: Button
    private var pendingUpdate: UpdateMetadata? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    private fun buildContent(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(10, 20, 26))
        }
        body.addView(TextView(this).apply {
            text = "CẬP NHẬT ULTRACARHCM V2"
            textSize = 26f
            setTextColor(Color.WHITE)
        })
        body.addView(TextView(this).apply {
            text =
                "Kiểm tra cập nhật chạy độc lập với thông báo. " +
                "Metadata và gói tải phải dùng HTTPS; SHA-256 của bytes tải về phải khớp metadata."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(8), 0, dp(16))
        })

        status = TextView(this).apply {
            text = "Chưa kiểm tra"
            textSize = 17f
            setTextColor(Color.WHITE)
            setPadding(0, dp(8), 0, dp(12))
        }
        body.addView(status)

        checkButton = Button(this).apply {
            text = "KIỂM TRA CẬP NHẬT"
            setOnClickListener { checkForUpdate() }
        }
        body.addView(
            checkButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        downloadButton = Button(this).apply {
            text = "TẢI & KIỂM TRA SHA-256"
            visibility = View.GONE
            setOnClickListener {
                val metadata = pendingUpdate ?: return@setOnClickListener
                downloadAndVerify(metadata)
            }
        }
        body.addView(
            downloadButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        return ScrollView(this).apply { addView(body) }
    }

    private fun checkForUpdate() {
        pendingUpdate = null
        downloadButton.visibility = View.GONE

        val endpoint = getString(R.string.v2_update_metadata_url).trim()
        if (endpoint.isEmpty()) {
            status.text =
                "Kênh cập nhật V2 chưa được cấu hình bằng endpoint đã xác minh. " +
                "Không dùng nhầm version.json của V1."
            return
        }
        if (!UpdateRules.isTrustedMetadataUrl(endpoint)) {
            status.text = "Từ chối endpoint không thuộc kênh V2 TEST đã xác minh."
            return
        }

        checkButton.isEnabled = false
        status.text = "Đang kiểm tra…"
        Thread {
            val result = runCatching { fetchMetadata(endpoint) }
            runOnUiThread {
                checkButton.isEnabled = true
                result.fold(
                    onSuccess = ::renderMetadata,
                    onFailure = {
                        status.text = "Không thể kiểm tra cập nhật: ${it.message ?: "lỗi không xác định"}"
                    },
                )
            }
        }.start()
    }

    private fun fetchMetadata(endpoint: String): UpdateMetadata {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8_000
            readTimeout = 8_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw IllegalStateException("HTTP ${connection.responseCode}")
            }
            val payload = connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                val out = StringBuilder()
                val buffer = CharArray(4096)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    out.append(buffer, 0, count)
                    if (out.length > MAX_METADATA_CHARS) {
                        throw IllegalArgumentException("metadata quá lớn")
                    }
                }
                out.toString()
            }
            val json = JSONObject(payload)
            return UpdateRules.validateJsonMetadataScalars(
                latestVersionCode = json.opt("latestVersionCode"),
                latestVersionName = json.opt("latestVersionName"),
                releaseAvailable = json.opt("releaseAvailable"),
                apkUrl = if (json.has("apkUrl")) json.opt("apkUrl") else null,
                sha256 = if (json.has("sha256")) json.opt("sha256") else null,
                releaseNotes = if (json.has("releaseNotes")) json.opt("releaseNotes") else null,
                mandatory = if (json.has("mandatory")) json.opt("mandatory") else null,
            ) ?: throw IllegalArgumentException("metadata cập nhật không hợp lệ")
        } finally {
            connection.disconnect()
        }
    }

    private fun renderMetadata(metadata: UpdateMetadata) {
        val current = currentVersionCode()
        if (!metadata.releaseAvailable) {
            status.text =
                "Kênh V2 TEST đã xác minh; hiện chưa có APK V2 TEST ký số được phát hành. " +
                "Build kênh: ${metadata.latestVersionName} (${metadata.latestVersionCode})."
            return
        }
        if (!UpdateRules.hasNewerVersion(current, metadata)) {
            status.text =
                "Đang dùng bản mới nhất theo kênh V2 đã cấu hình. " +
                "Build hiện tại: $current"
            return
        }

        recordUpdateNotice(metadata)
        pendingUpdate = metadata
        status.text = buildString {
            append("Có bản mới: ")
            append(metadata.latestVersionName)
            append(" (build ")
            append(metadata.latestVersionCode)
            append(")")
            if (metadata.releaseNotes.isNotEmpty()) {
                append("\n\n")
                append(metadata.releaseNotes)
            }
            append("\n\nSHA-256 mong đợi: ")
            append(metadata.sha256)
            append("\nGói chưa được tin cậy cho đến khi bytes tải về được kiểm SHA-256.")
            if (metadata.mandatory) append("\nBản cập nhật được đánh dấu bắt buộc bởi metadata.")
        }
        downloadButton.visibility = View.VISIBLE
    }

    private fun downloadAndVerify(metadata: UpdateMetadata) {
        checkButton.isEnabled = false
        downloadButton.isEnabled = false
        status.text =
            "Đang tải và kiểm SHA-256 cho ${metadata.latestVersionName} " +
            "(build ${metadata.latestVersionCode})…"

        Thread {
            val result = runCatching { fetchAndVerifyPayload(metadata) }
            runOnUiThread {
                checkButton.isEnabled = true
                downloadButton.isEnabled = true
                result.fold(
                    onSuccess = { byteCount ->
                        status.text =
                            "SHA-256 khớp metadata cho ${metadata.latestVersionName} " +
                            "(build ${metadata.latestVersionCode}), ${byteCount} bytes.\n" +
                            "Gói chỉ được xác minh tính toàn vẹn; V2 chưa tự cài đặt vì " +
                            "kênh cài đặt/phát hành chưa được nghiệm thu."
                    },
                    onFailure = {
                        status.text =
                            "Từ chối gói cập nhật: ${it.message ?: "không xác minh được SHA-256"}"
                    },
                )
            }
        }.start()
    }

    private fun fetchAndVerifyPayload(metadata: UpdateMetadata): Long {
        val connection = (URL(metadata.apkUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 20_000
            instanceFollowRedirects = false
            setRequestProperty(
                "Accept",
                "application/vnd.android.package-archive,application/octet-stream",
            )
        }
        try {
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw IllegalStateException("HTTP ${connection.responseCode}")
            }
            val declaredLength = connection.contentLengthLong
            if (declaredLength > MAX_APK_BYTES) {
                throw IllegalArgumentException("gói cập nhật vượt giới hạn kích thước")
            }

            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    total += count
                    if (total > MAX_APK_BYTES) {
                        throw IllegalArgumentException("gói cập nhật vượt giới hạn kích thước")
                    }
                    digest.update(buffer, 0, count)
                }
            }
            if (total <= 0L) throw IllegalArgumentException("gói cập nhật rỗng")

            val observedSha256 = digest.digest().joinToString("") { byte ->
                "%02X".format(byte.toInt() and 0xFF)
            }
            if (!UpdateRules.matchesExpectedSha256(metadata.sha256, observedSha256)) {
                throw SecurityException("SHA-256 không khớp metadata")
            }
            return total
        } finally {
            connection.disconnect()
        }
    }

    private fun recordUpdateNotice(metadata: UpdateMetadata) {
        val prefs = getSharedPreferences(NotificationRules.PREFS_NAME, Context.MODE_PRIVATE)
        val previousVersionCode = prefs.getLong(NotificationRules.KEY_VERSION_CODE, 0L)
        if (!NotificationRules.shouldReplaceNotice(previousVersionCode, metadata.latestVersionCode)) return

        prefs.edit()
            .putLong(NotificationRules.KEY_VERSION_CODE, metadata.latestVersionCode)
            .putString(
                NotificationRules.KEY_VERSION_NAME,
                NotificationRules.normalizeVersionName(metadata.latestVersionName),
            )
            .putString(
                NotificationRules.KEY_RELEASE_NOTES,
                NotificationRules.normalizeReleaseNotes(metadata.releaseNotes),
            )
            .putLong(NotificationRules.KEY_CREATED_AT, System.currentTimeMillis())
            .putBoolean(NotificationRules.KEY_READ, false)
            .apply()
    }

    private fun currentVersionCode(): Long {
        val info = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
            return 0L
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    }

    companion object {
        private const val MAX_METADATA_CHARS = 128 * 1024
        private const val MAX_APK_BYTES = 256L * 1024L * 1024L
    }
}
