package ai.tigeriq.ultracarhcm.v2

internal object ReportRules {
    fun csvCell(raw: String): String {
        val quote = '"'
        val escaped = raw.replace(quote.toString(), quote.toString() + quote)
        val needsQuotes = raw.any { it == ',' || it == quote || it == '\n' || it == '\r' }
        return if (needsQuotes) quote.toString() + escaped + quote else escaped
    }

    fun header(): String =
        "startedAt,durationSeconds,distanceMeters,rateVndPerKm,fareVnd"
}
