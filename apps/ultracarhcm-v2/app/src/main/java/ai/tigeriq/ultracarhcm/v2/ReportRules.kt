package ai.tigeriq.ultracarhcm.v2

internal data class TripReportRow(
    val startedAtEpochMs: Long,
    val durationSeconds: Long,
    val distanceMeters: Double,
    val rateVndPerKm: Double,
    val fareVnd: Long,
)

internal data class TripReportSummary(
    val tripCount: Int,
    val durationSeconds: Long,
    val distanceMeters: Double,
    val fareVnd: Long,
)

internal object ReportRules {
    fun csvCell(raw: String): String {
        val quote = '"'
        val escaped = raw.replace(quote.toString(), quote.toString() + quote)
        val needsQuotes = raw.any { it == ',' || it == quote || it == '\n' || it == '\r' }
        return if (needsQuotes) quote.toString() + escaped + quote else escaped
    }

    fun header(): String =
        "startedAt,durationSeconds,distanceMeters,rateVndPerKm,fareVnd"

    fun exportFileName(): String = "UltraCarHCM_V2_Trips.csv"

    fun summary(rows: List<TripReportRow>): TripReportSummary {
        var duration = 0L
        var distance = 0.0
        var fare = 0L
        for (row in rows) {
            duration = saturatingAdd(duration, row.durationSeconds.coerceAtLeast(0L))
            val nextDistance = distance + row.distanceMeters.coerceAtLeast(0.0)
            distance = if (nextDistance.isFinite()) nextDistance else Double.MAX_VALUE
            fare = saturatingAdd(fare, row.fareVnd.coerceAtLeast(0L))
        }
        return TripReportSummary(rows.size, duration, distance, fare)
    }

    fun buildCsv(
        rows: List<TripReportRow>,
        formatStartedAt: (Long) -> String,
    ): String {
        val out = StringBuilder()
        out.append('\uFEFF').append(header()).append('\n')
        for (row in rows) {
            val cells = listOf(
                formatStartedAt(row.startedAtEpochMs),
                row.durationSeconds.coerceAtLeast(0L).toString(),
                row.distanceMeters.coerceAtLeast(0.0).toString(),
                row.rateVndPerKm.coerceAtLeast(0.0).toString(),
                row.fareVnd.coerceAtLeast(0L).toString(),
            )
            out.append(cells.joinToString(",") { csvCell(it) }).append('\n')
        }
        return out.toString()
    }

    private fun saturatingAdd(left: Long, right: Long): Long =
        if (Long.MAX_VALUE - left < right) Long.MAX_VALUE else left + right
}
