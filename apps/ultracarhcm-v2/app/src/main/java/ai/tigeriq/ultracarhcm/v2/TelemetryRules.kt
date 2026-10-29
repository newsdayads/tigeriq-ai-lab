package ai.tigeriq.ultracarhcm.v2

import kotlin.math.roundToInt

internal object TelemetryRules {
    fun batteryPercent(level: Int, scale: Int): Int? {
        if (level < 0 || scale <= 0) return null
        return ((level.toDouble() / scale.toDouble()) * 100.0)
            .roundToInt()
            .coerceIn(0, 100)
    }

    fun validCoordinates(latitude: Double, longitude: Double): Boolean =
        latitude.isFinite() &&
            longitude.isFinite() &&
            latitude in -90.0..90.0 &&
            longitude in -180.0..180.0
}
