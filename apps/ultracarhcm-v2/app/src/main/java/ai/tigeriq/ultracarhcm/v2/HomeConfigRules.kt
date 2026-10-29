package ai.tigeriq.ultracarhcm.v2

/** Local HOME preferences only; this does not imply parity with original V1 layouts. */
internal object HomeConfigRules {
    const val MAX_SAVED = 20
    const val MAX_NAME_LENGTH = 48
    const val CURRENT_SCHEMA_VERSION = 3

    fun normalizeName(value: String): String = value.trim().take(MAX_NAME_LENGTH)
    fun canSave(existingCount: Int): Boolean = existingCount in 0 until MAX_SAVED

    /** Schema 0 means legacy JSON written before explicit versioning. */
    fun canReadSchema(version: Int): Boolean = version in 0..CURRENT_SCHEMA_VERSION
}
