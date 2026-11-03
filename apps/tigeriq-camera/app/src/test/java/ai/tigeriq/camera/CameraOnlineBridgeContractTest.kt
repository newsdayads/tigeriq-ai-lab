package ai.tigeriq.camera

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class CameraOnlineBridgeContractTest {
    private val bridge=File("src/main/java/ai/tigeriq/camera/CameraOnlineBridge.kt").readText()
    private val manifest=File("src/main/AndroidManifest.xml").readText()
    @Test fun telemetryRequiresPairingAndHttps() {
        assertTrue(bridge.contains("https://pc01.tail35d2f3.ts.net/camera-relay"))
        assertTrue(bridge.contains("Authorization"))
        assertTrue(bridge.contains("isPaired"))
        assertTrue(bridge.contains("schedule(app)"))
        assertTrue(bridge.contains("flushInternal"))
        assertTrue(manifest.contains("allowBackup=\"false\""))
    }
    @Test fun downloadedApkRequiresSignerAndHash() {
        assertTrue(bridge.contains("SHA-256"))
        assertTrue(bridge.contains("GET_SIGNING_CERTIFICATES"))
        assertTrue(bridge.contains("verifyApk(context,temp,version)"))
        assertTrue(bridge.contains("FileProvider.getUriForFile"))
        assertTrue(bridge.contains("canRequestPackageInstalls"))
        assertFalse(bridge.contains("Runtime.getRuntime().exec"))
    }
    @Test fun backgroundUsesSystemScheduler() {
        assertTrue(bridge.contains("setPeriodic(15*60*1000L)"))
        assertTrue(bridge.contains("JobScheduler"))
        assertTrue(manifest.contains("CameraOnlineJobService"))
        assertTrue(manifest.contains("REQUEST_INSTALL_PACKAGES"))
    }
}
