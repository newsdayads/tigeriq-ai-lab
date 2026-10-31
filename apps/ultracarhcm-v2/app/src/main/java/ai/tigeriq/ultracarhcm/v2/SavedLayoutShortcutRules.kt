package ai.tigeriq.ultracarhcm.v2

import java.util.Locale
import java.util.UUID

/** Five V1-evidenced HOME saved-layout shortcuts backed by stable V2 config IDs. */
internal object SavedLayoutShortcutRules {
    const val SLOT_COUNT = 5
    const val PREFS_NAME = "ultracar_v2_saved_layout_shortcuts"
    private const val MAX_CONFIG_ID_LENGTH = 64
    private val uuidPattern = Regex(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    )

    fun slotKey(index: Int): String? =
        index.takeIf { it in 0 until SLOT_COUNT }?.let { "slot_$it" }

    fun normalizeConfigId(value: String): String =
        value.trim().lowercase(Locale.ROOT).take(MAX_CONFIG_ID_LENGTH)

    fun validConfigId(value: String): Boolean =
        uuidPattern.matches(normalizeConfigId(value))

    fun freshConfigId(): String = UUID.randomUUID().toString()
}
