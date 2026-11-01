package ai.tigeriq.ultracarhcm.v2

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

class UpdateActivity : ComponentActivity() {
    private lateinit var status: TextView
    private lateinit var checkButton: Button
    private lateinit var downloadButton: Button
    private lateinit var installButton: Button
    private var pendingUpdate: UpdateMetadata? = null
    private var verifiedApk: VerifiedApk? = null
    @Volatile private var operationGeneration = 0L
    @Volatile private var activityDestroyed = false
    private var installerHandoff = false

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
                "Metadata, SHA-256, package, version và chữ ký APK đều phải khớp trước khi mở trình cài đặt Android."
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
            text = "TẢI & XÁC MINH APK"
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

        installButton = Button(this).apply {
            text = "MỞ TRÌNH CÀI ĐẶT ANDROID"
            visibility = View.GONE
            setOnClickListener {
                val candidate = verifiedApk ?: return@setOnClickListener
                launchSystemInstaller(candidate)
            }
        }
        body.addView(
            installButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        return ScrollView(this).apply { addView(body) }
    }

    private fun checkForUpdate() {
        clearVerifiedCandidate()
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

        val generation = beginOperation()
        checkButton.isEnabled = false
        status.text = "Đang kiểm tra…"
        Thread {
            val result = runCatching { fetchMetadata(endpoint) }
            if (!isOperationCurrent(generation)) return@Thread
            runOnUiThread {
                if (!isOperationCurrent(generation) || isFinishing || isDestroyed) {
                    return@runOnUiThread
                }
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

        val noticeRecorded = recordUpdateNotice(metadata)
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
            append("\nGói chưa được tin cậy cho đến khi tải xong và xác minh package/version/chữ ký.")
            if (metadata.mandatory) append("\nBản cập nhật được đánh dấu bắt buộc bởi metadata.")
            if (!noticeRecorded) {
                append("\n\nKhông thể lưu thông báo cập nhật cục bộ trên thiết bị.")
            }
        }
        downloadButton.visibility = View.VISIBLE
    }

    private fun downloadAndVerify(metadata: UpdateMetadata) {
        clearVerifiedCandidate()
        val generation = beginOperation()
        checkButton.isEnabled = false
        downloadButton.isEnabled = false
        status.text =
            "Đang tải và xác minh ${metadata.latestVersionName} " +
            "(build ${metadata.latestVersionCode})…"

        Thread {
            val result = runCatching { fetchAndVerifyPayload(metadata) }
            if (!isOperationCurrent(generation)) {
                result.getOrNull()?.file?.delete()
                return@Thread
            }
            runOnUiThread {
                if (!isOperationCurrent(generation) || isFinishing || isDestroyed) {
                    result.getOrNull()?.file?.delete()
                    return@runOnUiThread
                }
                checkButton.isEnabled = true
                downloadButton.isEnabled = true
                result.fold(
                    onSuccess = { candidate ->
                        verifiedApk = candidate
                        installButton.visibility = View.VISIBLE
                        status.text =
                            "APK đã xác minh: ${metadata.latestVersionName} " +
                            "(build ${metadata.latestVersionCode}), ${candidate.byteCount} bytes.\n" +
                            "SHA-256, package, version và signer đều khớp. " +
                            "Cài đặt chỉ tiếp tục qua màn hình xác nhận của Android."
                    },
                    onFailure = {
                        status.text =
                            "Từ chối gói cập nhật: ${it.message ?: "không xác minh được APK"}"
                    },
                )
            }
        }.start()
    }

    private fun fetchAndVerifyPayload(metadata: UpdateMetadata): VerifiedApk {
        val updateDir = File(cacheDir, "updates")
        if (!updateDir.exists() && !updateDir.mkdirs()) {
            throw IllegalStateException("không tạo được thư mục cập nhật cục bộ")
        }
        val target = File(updateDir, "UltraCarHCM_V2_${metadata.latestVersionCode}.apk")
        if (target.exists() && !target.delete()) {
            throw IllegalStateException("không xóa được gói cập nhật cũ")
        }

        var keep = false
        try {
            val connection = openTrustedPayloadConnection(metadata.apkUrl)
            try {
                val declaredLength = connection.contentLengthLong
                if (declaredLength > MAX_APK_BYTES) {
                    throw IllegalArgumentException("gói cập nhật vượt giới hạn kích thước")
                }

                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                connection.inputStream.use { input ->
                    FileOutputStream(target, false).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            if (count == 0) continue
                            total += count
                            if (total > MAX_APK_BYTES) {
                                throw IllegalArgumentException("gói cập nhật vượt giới hạn kích thước")
                            }
                            output.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                        }
                        output.fd.sync()
                    }
                }
                if (total <= 0L) throw IllegalArgumentException("gói cập nhật rỗng")

                val observedSha256 = digest.digest().joinToString("") { byte ->
                    "%02X".format(byte.toInt() and 0xFF)
                }
                if (!UpdateRules.matchesExpectedSha256(metadata.sha256, observedSha256)) {
                    throw SecurityException("SHA-256 không khớp metadata")
                }
                verifyZipHeader(target)
                val candidate = verifyCandidateIdentity(target, metadata, total)
                keep = true
                return candidate
            } finally {
                connection.disconnect()
            }
        } finally {
            if (!keep && target.exists()) target.delete()
        }
    }

    private fun openTrustedPayloadConnection(initialUrl: String): HttpURLConnection {
        var current = initialUrl.trim()
        for (redirectCount in 0..MAX_REDIRECTS) {
            if (!UpdateRules.isTrustedV2PayloadUrl(current)) {
                throw SecurityException("nguồn tải APK chưa được phê duyệt")
            }
            val connection = (URL(current).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 12_000
                readTimeout = 30_000
                instanceFollowRedirects = false
                setRequestProperty(
                    "Accept",
                    "application/vnd.android.package-archive,application/octet-stream",
                )
                setRequestProperty("User-Agent", "TigerIQ-UltraCarHCM-V2")
            }
            val code = connection.responseCode
            if (code == HttpURLConnection.HTTP_OK) return connection
            if (code !in REDIRECT_CODES || redirectCount >= MAX_REDIRECTS) {
                connection.disconnect()
                throw IllegalStateException("HTTP $code")
            }
            val location = connection.getHeaderField("Location")
            connection.disconnect()
            if (location.isNullOrBlank()) {
                throw IllegalStateException("redirect cập nhật thiếu Location")
            }
            current = URI(current).resolve(location).toString()
        }
        throw IllegalStateException("quá nhiều redirect cập nhật")
    }

    private fun verifyZipHeader(file: File) {
        FileInputStream(file).use { input ->
            if (input.read() != 0x50 || input.read() != 0x4B) {
                throw SecurityException("tệp tải không phải APK ZIP")
            }
        }
    }

    private fun verifyCandidateIdentity(
        file: File,
        metadata: UpdateMetadata,
        byteCount: Long,
    ): VerifiedApk {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }
        val candidate = packageManager.getPackageArchiveInfo(file.absolutePath, flags)
            ?: throw SecurityException("Android không đọc được package APK")
        val installed = packageManager.getPackageInfo(packageName, flags)
        val candidateCode = packageVersionCode(candidate)
        if (candidate.packageName != packageName ||
            candidateCode != metadata.latestVersionCode ||
            !UpdateRules.matchesExpectedVersionName(
                metadata.latestVersionName,
                candidate.versionName,
            ) ||
            candidateCode <= packageVersionCode(installed)
        ) {
            throw SecurityException("APK sai package, versionCode hoặc versionName")
        }

        val candidateSigner = signerSha256(candidate)
        val installedSigner = signerSha256(installed)
        if (!UpdateRules.matchesPinnedSignerSha256(EXPECTED_SIGNER_SHA256, candidateSigner) ||
            !candidateSigner.equals(installedSigner, ignoreCase = true)
        ) {
            throw SecurityException("chữ ký APK không đúng khóa UltraCar V2 đã dùng")
        }
        return VerifiedApk(file, byteCount, candidateSigner)
    }

    private fun packageVersionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

    private fun signerSha256(info: PackageInfo): String {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners
        } else {
            @Suppress("DEPRECATION")
            info.signatures
        } ?: throw SecurityException("không tìm thấy chữ ký APK")
        if (signatures.size != 1) throw SecurityException("APK signer không hợp lệ")
        return MessageDigest.getInstance("SHA-256")
            .digest(signatures[0].toByteArray())
            .joinToString("") { byte -> "%02X".format(byte.toInt() and 0xFF) }
    }

    private fun launchSystemInstaller(candidate: VerifiedApk) {
        if (!candidate.file.exists()) {
            clearVerifiedCandidate()
            status.text = "Gói đã xác minh không còn trên thiết bị; hãy tải lại."
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName"),
                ),
            )
            status.text =
                "Android yêu cầu bật quyền cài ứng dụng từ nguồn này. " +
                "Sau khi cấp quyền, quay lại và bấm MỞ TRÌNH CÀI ĐẶT ANDROID."
            return
        }

        val uri = FileProvider.getUriForFile(
            this,
            "$packageName.fileprovider",
            candidate.file,
        )
        startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, APK_MIME_TYPE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
        )
        installerHandoff = true
        status.text =
            "Đã chuyển APK đã xác minh sang trình cài đặt Android. " +
            "Android vẫn yêu cầu người dùng xác nhận trước khi cài."
    }

    private fun beginOperation(): Long {
        operationGeneration += 1L
        return operationGeneration
    }

    private fun isOperationCurrent(generation: Long): Boolean =
        !activityDestroyed && generation == operationGeneration

    private fun clearVerifiedCandidate() {
        verifiedApk?.file?.delete()
        verifiedApk = null
        if (::installButton.isInitialized) installButton.visibility = View.GONE
    }

    override fun onDestroy() {
        activityDestroyed = true
        operationGeneration += 1L
        if (!installerHandoff) clearVerifiedCandidate()
        super.onDestroy()
    }

    private fun recordUpdateNotice(metadata: UpdateMetadata): Boolean {
        val prefs = getSharedPreferences(NotificationRules.PREFS_NAME, Context.MODE_PRIVATE)
        val previousVersionCode = prefs.getLong(NotificationRules.KEY_VERSION_CODE, 0L)
        if (!NotificationRules.shouldReplaceNotice(previousVersionCode, metadata.latestVersionCode)) {
            return true
        }

        return prefs.edit()
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
            .commit()
    }

    private fun currentVersionCode(): Long {
        val info = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
            return 0L
        }
        return packageVersionCode(info)
    }

    private data class VerifiedApk(
        val file: File,
        val byteCount: Long,
        val signerSha256: String,
    )

    companion object {
        private const val MAX_METADATA_CHARS = 128 * 1024
        private const val MAX_APK_BYTES = 256L * 1024L * 1024L
        private const val MAX_REDIRECTS = 3
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
        private const val EXPECTED_SIGNER_SHA256 =
            "71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558"
        private val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
    }
}
