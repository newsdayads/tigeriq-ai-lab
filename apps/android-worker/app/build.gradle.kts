plugins { id("com.android.application") }

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

android {
    namespace = "ai.tigeriq.worker"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.tigeriq.worker"
        minSdk = 26
        targetSdk = 35
        versionCode = 9
        versionName = "0.6.2-phone-first"
    }

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
            // CI/debug remains disposable and must never use the production/pilot signing identity.
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

tasks.register("tigerIqStableSigningStatus") {
    doLast {
        println(if (stableSigningEnabled) "TIGERIQ_STABLE_SIGNING_CONFIGURED" else "TIGERIQ_STABLE_SIGNING_NOT_CONFIGURED")
    }
}
