package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test

class VideoSignalClassifierTest {
    private val idle=UvcFrameSignalEvidence.Metrics(1024,30.0,0.2,0.0,2)
    private val active=UvcFrameSignalEvidence.Metrics(1024,106.9,848.8,0.0,13)
    private val dark=UvcFrameSignalEvidence.Metrics(1024,10.0,0.5,1.0,1)
    private val unknown=UvcFrameSignalEvidence.Metrics(1024,44.0,12.0,0.0,3)
    @Test fun falsePositivesDoNotOpenAfterOneOrTwoActiveFrames() {
        val c=VideoSignalClassifier()
        repeat(4) { assertNull(c.accept(active)) }
        assertEquals(VideoSignalClassifier.State.VIDEO_ACTIVE,c.accept(active))
        assertNull(c.accept(active))
    }
    @Test fun converterIdlePatternAfterSustainedFramesOnly() {
        val c=VideoSignalClassifier()
        repeat(5){c.accept(active)}
        repeat(6){assertNull(c.accept(idle))}
        assertEquals(VideoSignalClassifier.State.IDLE_PATTERN,c.accept(idle))
    }
    @Test fun nightDarkIsNotPOrD() {
        val c=VideoSignalClassifier()
        repeat(5){c.accept(active)}
        repeat(20){assertNull(c.accept(dark))}
        assertEquals(VideoSignalClassifier.State.VIDEO_ACTIVE,c.state)
    }
    @Test fun unknownFramesResetCandidateButNotKnownState() {
        val c=VideoSignalClassifier()
        repeat(3){c.accept(active)}
        assertNull(c.accept(unknown))
        repeat(4){assertNull(c.accept(active))}
        assertEquals(VideoSignalClassifier.State.VIDEO_ACTIVE,c.accept(active))
    }
    @Test fun frameStopNeverMeansRoff() {
        val c=VideoSignalClassifier()
        repeat(5){c.accept(active)}
        assertEquals(VideoSignalClassifier.State.VIDEO_ACTIVE,c.state)
        // No frames means no accept() call; no timed false R-OFF.
        assertEquals(VideoSignalClassifier.State.VIDEO_ACTIVE,c.state)
    }
    @Test fun sourceNeverUsesUsbPresenceAsReverse() {
        val service=java.io.File("src/main/java/ai/tigeriq/camera/FloatingCameraService.kt").readText()
        val monitor=java.io.File("src/main/java/ai/tigeriq/camera/UvcSignalMonitor.kt").readText()
        assertTrue(service.contains("USB_LOST_NOT_R_OFF"))
        assertTrue(service.contains("USB_ATTACH_NOT_GEAR"))
        assertTrue(service.contains("signalMonitor?.stop()"))
        assertTrue(monitor.contains("no_visible_window"))
        assertTrue(monitor.contains("setFrameCallback(IFrameCallback"))
        assertFalse(monitor.contains("CameraActivity.launch("))
        assertFalse(monitor.contains("WindowManager.addView("))
    }
    @Test fun approvedLayoutAndGuideStylingUnaffected() {
        val source=java.io.File("src/main/java/ai/tigeriq/camera/DynamicGuideView.kt").readText()
        assertTrue(source.contains("drawSportRacing("))
        assertTrue(source.contains("drawPorscheGt("))
        assertTrue(source.contains("drawAudiMatrix("))
        assertTrue(source.contains("drawTeslaCyber("))
        assertTrue(source.contains("drawLuxuryOem("))
        assertTrue(source.contains("val bottomHalfW = (w * 0.30f * scale)"))
        assertTrue(source.contains("val topHalfW = (w * 0.13f * scale)"))
    }
}
