package ai.tigeriq.ultracarhcm.v2

import java.util.Locale

internal object VehicleRules {
    const val PREF_MODEL = "vehicle_model"
    const val PREF_LICENSE_PLATE = "vehicle_license_plate"
    const val MODEL_LIMO_RED = "limo_red"
    const val MODEL_LAMBORGHINI_WHITE = "lamborghini_white"
    const val MAX_LICENSE_PLATE_LENGTH = 20

    fun isSupportedModel(model: String?): Boolean =
        model == MODEL_LIMO_RED || model == MODEL_LAMBORGHINI_WHITE

    fun currentModel(stored: String?, legacyLimo: Boolean): String = when (stored) {
        MODEL_LIMO_RED, MODEL_LAMBORGHINI_WHITE -> stored
        else -> if (legacyLimo) MODEL_LIMO_RED else MODEL_LAMBORGHINI_WHITE
    }

    fun normalizeLicensePlate(raw: String): String =
        raw.trim()
            .replace(Regex("\\s+"), " ")
            .uppercase(Locale.ROOT)
            .take(MAX_LICENSE_PLATE_LENGTH)

    fun modelLabel(model: String): String = when (model) {
        MODEL_LIMO_RED -> "Limo đỏ"
        MODEL_LAMBORGHINI_WHITE -> "Lamborghini trắng"
        else -> "Xe chưa xác định"
    }
}
