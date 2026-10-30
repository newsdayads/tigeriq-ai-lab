package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickSlotRulesTest {
    @Test
    fun mapsV164CategoriesToExpectedIconFamilies() {
        assertEquals(QuickSlotIcon.PLAY, QuickSlotRules.iconFor("YouTube", "com.google.android.youtube"))
        assertEquals(QuickSlotIcon.PLAY, QuickSlotRules.iconFor("Zing MP3", "com.zing.mp3"))
        assertEquals(QuickSlotIcon.PLAY, QuickSlotRules.iconFor("Spotify", "com.spotify.music"))
        assertEquals(QuickSlotIcon.CAR, QuickSlotRules.iconFor("Grab", "com.grabtaxi.passenger"))
        assertEquals(QuickSlotIcon.CAR, QuickSlotRules.iconFor("Be", "vn.be.driver"))
        assertEquals(QuickSlotIcon.CAR, QuickSlotRules.iconFor("GreenSM Taxi", "vn.example.greensm"))
        assertEquals(QuickSlotIcon.PLAY, QuickSlotRules.iconFor("YouTube", "com.google.android.youtube"))
        assertEquals(QuickSlotIcon.ROUTE, QuickSlotRules.iconFor("VietMap", "vn.example.vietmap"))
        assertEquals(QuickSlotIcon.ROUTE, QuickSlotRules.iconFor("Navitel", "com.navitel"))
        assertEquals(QuickSlotIcon.CAMERA, QuickSlotRules.iconFor("Camera USB", QuickSlotRules.CAMERA_TARGET))
        assertEquals(QuickSlotIcon.ADD, QuickSlotRules.iconFor("", ""))
        assertEquals(QuickSlotIcon.APPS, QuickSlotRules.iconFor("Khác", "com.example.other"))
    }

    @Test
    fun customAssignmentRequiresDisplayNameAndValidAndroidPackage() {
        val assignment = QuickSlotRules.parseCustomAssignment("  Be Partner  | vn.be.driver ")
        requireNotNull(assignment)
        assertEquals("Be Partner", assignment.label)
        assertEquals("vn.be.driver", assignment.target)

        assertNull(QuickSlotRules.parseCustomAssignment("Thiếu package"))
        assertNull(QuickSlotRules.parseCustomAssignment("Tên | not-a-package"))
        assertNull(QuickSlotRules.parseCustomAssignment(" | com.example.app"))
    }

    @Test
    fun normalizesPersistedTargetsWithoutUnboundedValues() {
        assertEquals("com.example.app", QuickSlotRules.normalizeTarget("  com.example.app  "))
        assertEquals("x".repeat(160), QuickSlotRules.normalizeTarget("x".repeat(200)))
    }

    @Test
    fun persistedAssignmentsFailClosedOnMalformedTargets() {
        assertTrue(QuickSlotRules.isValidPersistedAssignment("", ""))
        assertTrue(QuickSlotRules.isValidPersistedAssignment("Camera USB", QuickSlotRules.CAMERA_TARGET))
        assertTrue(QuickSlotRules.isValidPersistedAssignment("Maps", "com.google.android.apps.maps"))
        assertFalse(QuickSlotRules.isValidPersistedAssignment("", "com.example.app"))
        assertFalse(QuickSlotRules.isValidPersistedAssignment("Broken", "not-a-package"))
        assertFalse(QuickSlotRules.isValidPersistedAssignment("x".repeat(29), "com.example.app"))
        assertFalse(QuickSlotRules.isValidPersistedAssignment("App", "x".repeat(161)))
    }

    @Test
    fun quickBarKeepsExactlyThreeRowsOfThreeSlots() {
        assertEquals(9, QuickSlotRules.SLOT_COUNT)
        assertTrue(QuickSlotRules.SLOT_COUNT % 3 == 0)
    }
}
