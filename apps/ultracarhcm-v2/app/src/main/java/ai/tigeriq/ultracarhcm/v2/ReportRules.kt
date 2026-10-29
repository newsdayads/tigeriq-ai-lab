package ai.tigeriq.ultracarhcm.v2

internal object ReportRules {
    fun csvCell(raw: String): String {
        val escaped = raw.replace(""", """")
        val needsQuotes = raw.contains(',') || raw.contains('"') || raw.contains('\n') || raw.contains('\r')
        return if (needsQuotes) ""$escaped"" else escaped
    }

    fun header(): String =
        "startedAt,durationSeconds,distanceMeters,rateVndPerKm,fareVnd"
}
