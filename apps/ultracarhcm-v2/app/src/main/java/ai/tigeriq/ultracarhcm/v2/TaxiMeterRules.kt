package ai.tigeriq.ultracarhcm.v2

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

internal object TaxiMeterRules {
    private const val EARTH_RADIUS_METERS = 6_371_000.0
    const val PREFS_NAME = "ultracar_v2_taxi_meter"
    const val KEY_RATE = "rate_vnd_per_km"
    const val KEY_HISTORY = "trip_history_json"
    const val MAX_HISTORY = 100

    fun parseRateVndPerKm(raw: String): Double? {
        val value = raw.trim().replace(',', '.').toDoubleOrNull() ?: return null
        return value.takeIf(::validRateVndPerKm)
    }

    fun validRateVndPerKm(value: Double): Boolean =
        value.isFinite() && value > 0.0 && value <= 1_000_000.0

    fun validCoordinates(latitude: Double, longitude: Double): Boolean =
        latitude.isFinite() &&
            longitude.isFinite() &&
            latitude in -90.0..90.0 &&
            longitude in -180.0..180.0

    fun segmentMeters(
        fromLatitude: Double,
        fromLongitude: Double,
        toLatitude: Double,
        toLongitude: Double,
    ): Double? {
        if (!validCoordinates(fromLatitude, fromLongitude) ||
            !validCoordinates(toLatitude, toLongitude)) return null

        val lat1 = Math.toRadians(fromLatitude)
        val lat2 = Math.toRadians(toLatitude)
        val deltaLat = lat2 - lat1
        val deltaLon = Math.toRadians(toLongitude - fromLongitude)
        val a = sin(deltaLat / 2.0) * sin(deltaLat / 2.0) +
            cos(lat1) * cos(lat2) *
            sin(deltaLon / 2.0) * sin(deltaLon / 2.0)
        val clamped = a.coerceIn(0.0, 1.0)
        return 2.0 * EARTH_RADIUS_METERS * atan2(sqrt(clamped), sqrt(1.0 - clamped))
    }

    fun fareVnd(rateVndPerKm: Double, distanceMeters: Double): Long? {
        if (!rateVndPerKm.isFinite() || rateVndPerKm <= 0.0 ||
            !distanceMeters.isFinite() || distanceMeters < 0.0) return null
        return (rateVndPerKm * distanceMeters / 1000.0).roundToLong()
    }

    fun validActiveTripState(
        rateVndPerKm: Double,
        distanceMeters: Double,
        activeElapsedMs: Long,
        tripStartedEpochMs: Long,
    ): Boolean =
        validRateVndPerKm(rateVndPerKm) &&
            distanceMeters.isFinite() &&
            distanceMeters >= 0.0 &&
            activeElapsedMs >= 0L &&
            tripStartedEpochMs > 0L

    fun elapsedSeconds(elapsedMillis: Long): Long =
        elapsedMillis.coerceAtLeast(0L) / 1000L
}
