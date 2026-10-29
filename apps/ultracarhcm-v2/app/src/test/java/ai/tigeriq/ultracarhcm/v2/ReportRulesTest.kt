package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
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
}
