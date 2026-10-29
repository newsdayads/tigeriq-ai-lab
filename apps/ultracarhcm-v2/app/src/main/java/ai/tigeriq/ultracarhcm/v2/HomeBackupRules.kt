package ai.tigeriq.ultracarhcm.v2

/** Safe local backup envelope for V2-owned HOME state only. */
internal object HomeBackupRules {
    const val CURRENT_BACKUP_SCHEMA_VERSION = 1
    const val MAX_BACKUP_BYTES = 256 * 1024

    fun canReadBackupSchema(version: Int): Boolean =
        version == CURRENT_BACKUP_SCHEMA_VERSION

    fun withinSize(byteCount: Int): Boolean =
        byteCount in 1..MAX_BACKUP_BYTES

    fun exportFileName(): String = "ultracarhcm-v2-home-backup.json"
}
