package ai.tigeriq.ultracarhcm.v2

internal object NotificationRules {
    const val PREFS_NAME = "ultracar_v2_notifications"
    const val KEY_VERSION_CODE = "update_version_code"
    const val KEY_VERSION_NAME = "update_version_name"
    const val KEY_RELEASE_NOTES = "update_release_notes"
    const val KEY_CREATED_AT = "update_created_at"
    const val KEY_READ = "update_read"

    private const val MAX_VERSION_NAME_CHARS = 120
    private const val MAX_RELEASE_NOTES_CHARS = 4_000

    fun shouldReplaceNotice(previousVersionCode: Long, latestVersionCode: Long): Boolean =
        latestVersionCode > 0L && latestVersionCode > previousVersionCode

    fun isResolvedNotice(currentVersionCode: Long, noticeVersionCode: Long): Boolean =
        currentVersionCode > 0L &&
            noticeVersionCode > 0L &&
            noticeVersionCode <= currentVersionCode

    fun unreadCount(versionCode: Long, read: Boolean): Int =
        if (versionCode > 0L && !read) 1 else 0

    fun normalizeVersionName(raw: String): String =
        raw.trim().take(MAX_VERSION_NAME_CHARS)

    fun normalizeReleaseNotes(raw: String): String =
        raw.trim().take(MAX_RELEASE_NOTES_CHARS)
}
