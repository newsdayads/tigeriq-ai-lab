package ai.tigeriq.ultracarhcm.v2

import java.util.Locale

internal enum class QuickSlotIcon {
    PLAY,
    CAR,
    ROUTE,
    CAMERA,
    ADD,
    APPS,
}

internal data class QuickSlotAssignment(
    val label: String,
    val target: String,
)

/**
 * Device-local QuickBar rules reconstructed from V1.0.64 behavior.
 * This class deliberately contains no Android runtime dependency so it can be unit-tested.
 */
internal object QuickSlotRules {
    const val SLOT_COUNT = 9
    const val CAMERA_TARGET = "@camera"
    private const val MAX_LABEL_LENGTH = 28
    private const val MAX_TARGET_LENGTH = 160
    private val packageNamePattern =
        Regex("^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+$")

    fun normalizeLabel(value: String): String =
        value.trim().replace(Regex("\\s+"), " ").take(MAX_LABEL_LENGTH)

    fun normalizeTarget(value: String): String =
        value.trim().take(MAX_TARGET_LENGTH)

    fun iconFor(label: String, target: String): QuickSlotIcon {
        val normalizedLabel = normalizeLabel(label)
        val normalizedTarget = target.trim()
        if (normalizedLabel.isEmpty() && normalizedTarget.isEmpty()) return QuickSlotIcon.ADD
        if (normalizedTarget == CAMERA_TARGET) return QuickSlotIcon.CAMERA

        val key = "$normalizedLabel $normalizedTarget".lowercase(Locale.ROOT)
        return when {
            containsAny(key, "youtube", "nhạc", "nhac", "zing", "spotify", "media") ->
                QuickSlotIcon.PLAY
            containsAny(key, "grab", "be partner", "greensm", "xanh sm", "taxi") ||
                containsWord(key, "be") ->
                QuickSlotIcon.CAR
            containsAny(key, "bản đồ", "ban do", "map", "vietmap", "navitel", "route") ->
                QuickSlotIcon.ROUTE
            containsAny(key, "camera", "dashcam", "videocam") ->
                QuickSlotIcon.CAMERA
            else -> QuickSlotIcon.APPS
        }
    }

    fun isValidPersistedAssignment(label: String, target: String): Boolean {
        val trimmedLabel = label.trim()
        val trimmedTarget = target.trim()
        if (trimmedLabel.length > MAX_LABEL_LENGTH || trimmedTarget.length > MAX_TARGET_LENGTH) {
            return false
        }

        val safeLabel = normalizeLabel(label)
        val safeTarget = normalizeTarget(target)
        if (safeTarget.isEmpty()) return safeLabel.isEmpty()
        if (safeLabel.isEmpty()) return false
        if (safeTarget == CAMERA_TARGET) return true
        return packageNamePattern.matches(safeTarget)
    }

    fun parseCustomAssignment(value: String): QuickSlotAssignment? {
        val pieces = value.split('|', limit = 2)
        if (pieces.size != 2) return null

        val label = normalizeLabel(pieces[0])
        val target = normalizeTarget(pieces[1])
        if (label.isEmpty() || !packageNamePattern.matches(target)) return null
        return QuickSlotAssignment(label, target)
    }

    private fun containsAny(value: String, vararg needles: String): Boolean =
        needles.any(value::contains)

    private fun containsWord(value: String, word: String): Boolean =
        Regex("(^|[^a-z0-9])" + Regex.escape(word) + "([^a-z0-9]|$)")
            .containsMatchIn(value)
}
