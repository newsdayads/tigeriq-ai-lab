package ai.tigeriq.ultracarhcm.v2

/** Local HOME preferences only; this does not imply parity with original V1 layouts. */
internal object HomeConfigRules {
    const val MAX_SAVED = 20
    const val MAX_NAME_LENGTH = 48
    const val CURRENT_SCHEMA_VERSION = 3

    fun normalizeName(value: String): String = value.trim().take(MAX_NAME_LENGTH)
    fun canSave(existingCount: Int): Boolean = existingCount in 0 until MAX_SAVED

    fun reorderTarget(size: Int, index: Int, delta: Int): Int? {
        if (size < 2 || index !in 0 until size || (delta != -1 && delta != 1)) return null
        val target = index + delta
        return target.takeIf { it in 0 until size }
    }

    /** Schema 0 means legacy JSON written before explicit versioning. */
    fun canReadSchema(version: Int): Boolean = version in 0..CURRENT_SCHEMA_VERSION
}
