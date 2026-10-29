package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Test

class ReportRulesTest {
    @Test fun leavesSimpleCsvCellUnquoted() {
        assertEquals("7000", ReportRules.csvCell("7000"))
    }

    @Test fun quotesAndEscapesCsvSpecialCharacters() {
        assertEquals(""A,B"", ReportRules.csvCell("A,B"))
        assertEquals(""A""B"", ReportRules.csvCell("A"B"))
        assertEquals(""A\nB"", ReportRules.csvCell("A\nB"))
    }

    @Test fun exposesStableTripReportHeader() {
        assertEquals(
            "startedAt,durationSeconds,distanceMeters,rateVndPerKm,fareVnd",
            ReportRules.header(),
        )
    }
}
