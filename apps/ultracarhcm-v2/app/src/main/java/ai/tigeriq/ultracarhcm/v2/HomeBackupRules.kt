package ai.tigeriq.ultracarhcm.v2

/** Safe local backup envelope for V2-owned state only. */
internal object HomeBackupRules {
    const val LEGACY_BACKUP_SCHEMA_VERSION = 1
    const val CURRENT_BACKUP_SCHEMA_VERSION = 4
    const val MAX_BACKUP_BYTES = 256 * 1024
    const val MAX_OVERLAY_DISPLAYS = 16
    const val MAX_OVERLAY_COORDINATE = 32768

    fun canReadBackupSchema(version: Int): Boolean =
        version in LEGACY_BACKUP_SCHEMA_VERSION..CURRENT_BACKUP_SCHEMA_VERSION

    fun exactBoolean(value: Any?): Boolean? = value as? Boolean

    fun exactString(value: Any?): String? = value as? String

    fun exactInt(value: Any?): Int? {
        val longValue = exactLong(value) ?: return null
        if (longValue < Int.MIN_VALUE || longValue > Int.MAX_VALUE) return null
        return longValue.toInt()
    }

    fun exactLong(value: Any?): Long? {
        if (value !is Number) return null
        val doubleValue = value.toDouble()
        if (!doubleValue.isFinite()) return null
        val longValue = value.toLong()
        return longValue.takeIf { doubleValue == longValue.toDouble() }
    }

    fun exactDouble(value: Any?): Double? =
        (value as? Number)?.toDouble()?.takeIf { it.isFinite() }

    fun requiresOverlayPositions(version: Int): Boolean =
        version >= 2

    fun requiresVehicleState(version: Int): Boolean =
        version >= 3

    fun requiresTaxiMeterState(version: Int): Boolean =
        version >= 4

    fun withinSize(byteCount: Int): Boolean =
        byteCount in 1..MAX_BACKUP_BYTES

    fun validOverlayDisplayId(displayId: Int): Boolean =
        displayId in 0..1024

    fun validOverlayCoordinate(value: Int): Boolean =
        value in 0..MAX_OVERLAY_COORDINATE

    fun displayIdFromOverlayKey(key: String): Int? {
        val match = Regex("^display_(\\d+)_[xy]$").matchEntire(key) ?: return null
        return match.groupValues[1].toIntOrNull()?.takeIf(::validOverlayDisplayId)
    }

    fun exportFileName(): String = "ultracarhcm-v2-home-backup.json"
}
