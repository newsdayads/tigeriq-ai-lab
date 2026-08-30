plugins { id("com.android.application") }

android {
    namespace = "ai.tigeriq.worker"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.tigeriq.worker"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0-pilot"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
