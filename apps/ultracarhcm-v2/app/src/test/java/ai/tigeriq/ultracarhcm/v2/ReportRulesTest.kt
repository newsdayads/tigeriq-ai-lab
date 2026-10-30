package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReportRulesTest {
    @Test fun leavesSimpleCsvCellUnquoted() {
        assertEquals("7000", ReportRules.csvCell("7000"))
    }

    @Test fun quotesAndEscapesCsvSpecialCharacters() {
        val quote = '"'
        assertEquals(quote.toString() + "A,B" + quote, ReportRules.csvCell("A,B"))
        val withQuote = "A" + quote + "B"
        val escaped = quote.toString() + "A" + quote + quote + "B" + quote
        assertEquals(escaped, ReportRules.csvCell(withQuote))
    }

    @Test fun exposesStableTripReportHeader() {
        assertEquals(
            "startedAt,durationSeconds,distanceMeters,rateVndPerKm,fareVnd",
            ReportRules.header(),
        )
    }

    @Test fun aggregatesTripSummaryFromV2OwnedRows() {
        val rows = listOf(
            TripReportRow(1000L, 60L, 1500.0, 7000.0, 10500L),
            TripReportRow(2000L, 90L, 2500.0, 7000.0, 17500L),
        )
        assertEquals(
            TripReportSummary(2, 150L, 4000.0, 28000L),
            ReportRules.summary(rows),
        )
    }

    @Test fun buildsUtf8BomCsvWithStableColumns() {
        val rows = listOf(TripReportRow(1000L, 60L, 1500.5, 7000.0, 10504L))
        val csv = ReportRules.buildCsv(rows) { "1970-01-01 00:00:01" }
        assertTrue(csv.startsWith("\uFEFF" + ReportRules.header() + "\n"))
        assertTrue(csv.contains("1970-01-01 00:00:01,60,1500.5,7000.0,10504\n"))
    }

    @Test fun exposesStableCsvExportName() {
        assertEquals("UltraCarHCM_V2_Trips.csv", ReportRules.exportFileName())
    }
}
