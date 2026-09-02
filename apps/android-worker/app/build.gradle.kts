import java.io.FileInputStream
import java.security.KeyStore
import java.security.MessageDigest

plugins { id("com.android.application") }

val expectedPilotSigningCertSha256 = "a1365f07f4259260a06fa033f7f878521a3b08bd2944fc1607494664937cc1ac"
val stableSigning = mapOf(
    "keystore" to System.getenv("TIGERIQ_ANDROID_KEYSTORE"),
    "alias" to System.getenv("TIGERIQ_ANDROID_KEY_ALIAS"),
    "storePasswordFile" to System.getenv("TIGERIQ_ANDROID_STORE_PASSWORD_FILE"),
    "keyPasswordFile" to System.getenv("TIGERIQ_ANDROID_KEY_PASSWORD_FILE"),
)
val stableSigningProvided = stableSigning.values.count { !it.isNullOrBlank() }
if (stableSigningProvided != 0 && stableSigningProvided != stableSigning.size) {
    throw GradleException("TigerIQ stable signing configuration is incomplete; provide all signing path variables or none")
}
val stableSigningEnabled = stableSigningProvided == stableSigning.size

fun signingCertificateSha256(keystorePath: String, storePassword: String, alias: String): String {
    var lastError: Exception? = null
    for (type in listOf("PKCS12", "JKS")) {
        try {
            val store = KeyStore.getInstance(type)
            FileInputStream(keystorePath).use { input -> store.load(input, storePassword.toCharArray()) }
            val certificate = store.getCertificate(alias)
                ?: throw GradleException("TigerIQ stable signing alias not found")
            return MessageDigest.getInstance("SHA-256")
                .digest(certificate.encoded)
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        } catch (error: Exception) {
            lastError = error
        }
    }
    throw GradleException("TigerIQ stable signing keystore could not be read", lastError)
}

val stableSigningFingerprint = if (stableSigningEnabled) {
    signingCertificateSha256(
        stableSigning.getValue("keystore")!!,
        file(stableSigning.getValue("storePasswordFile")!!).readText().trim(),
        stableSigning.getValue("alias")!!,
    ).also { actual ->
        if (!actual.equals(expectedPilotSigningCertSha256, ignoreCase = true)) {
            throw GradleException("TigerIQ stable signing certificate mismatch; refusing pilot release signing")
        }
    }
} else null

val sourceSha = (System.getenv("TIGERIQ_SOURCE_SHA") ?: "LOCAL_UNVERIFIED").trim().lowercase()
if (sourceSha != "local_unverified" && !Regex("^[0-9a-f]{40}$").matches(sourceSha)) {
    throw GradleException("TIGERIQ_SOURCE_SHA must be a 40-character commit SHA")
}

android {
    namespace = "ai.tigeriq.worker"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.tigeriq.worker"
        minSdk = 26
        targetSdk = 35
        versionCode = 13
        versionName = "1.0.1-ai-employee-preflight"
        buildConfigField("String", "TIGERIQ_SOURCE_SHA", "\"$sourceSha\"")
    }

    buildFeatures { buildConfig = true }

    // V1 is an independent phone AI employee. Direct children of ai/tigeriq/worker
    // are legacy v0.6 UI/Accessibility/controller sources and must never be packaged.
    sourceSets.getByName("main").java.exclude("ai/tigeriq/worker/*.java")

    if (stableSigningEnabled) {
        signingConfigs {
            create("tigeriqStable") {
                val keystorePath = stableSigning.getValue("keystore")!!
                val storePasswordPath = stableSigning.getValue("storePasswordFile")!!
                val keyPasswordPath = stableSigning.getValue("keyPasswordFile")!!
                storeFile = file(keystorePath)
                keyAlias = stableSigning.getValue("alias")!!
                storePassword = file(storePasswordPath).readText().trim()
                keyPassword = file(keyPasswordPath).readText().trim()
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        getByName("debug") {
            // CI/debug remains disposable and must never use the stable pilot signing identity.
        }
        getByName("release") {
            isMinifyEnabled = false
            if (stableSigningEnabled) signingConfig = signingConfigs.getByName("tigeriqStable")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.work:work-runtime:2.9.1")
    testImplementation("junit:junit:4.13.2")
    // Android's org.json classes are method stubs in local JVM tests. Use the
    // compatible JSON implementation only in the unit-test runtime.
    testImplementation("org.json:json:20240303")
}

tasks.register("tigerIqStableSigningStatus") {
    doLast {
        if (stableSigningEnabled) {
            println("TIGERIQ_STABLE_SIGNING_VERIFIED:$stableSigningFingerprint")
        } else {
            println("TIGERIQ_STABLE_SIGNING_NOT_CONFIGURED")
        }
    }
}
