plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
// Release builds use the owner's stable private key. Never commit the keystore or passwords.
val releaseEnvKeys = listOf(
    "MC_RELEASE_KEYSTORE_PATH",
    "MC_RELEASE_STORE_PASSWORD",
    "MC_RELEASE_KEY_ALIAS",
    "MC_RELEASE_KEY_PASSWORD",
)
val releaseValues = releaseEnvKeys.associateWith { System.getenv(it)?.takeIf(String::isNotBlank) }
val releaseConfigured = releaseValues.values.all { it != null }
val releaseTaskRequested = gradle.startParameter.taskNames.any {
    Regex("(?i)(assemble|bundle|package|install|publish).*release").containsMatchIn(it)
}
if (releaseTaskRequested && !releaseConfigured) {
    throw GradleException("Release signing is not configured. Set all four MC_RELEASE_* environment variables; do not use a regenerated debug key.")
}
val releaseKeystorePath = releaseValues["MC_RELEASE_KEYSTORE_PATH"]?.let { file(it) }
if (releaseConfigured && releaseKeystorePath?.isFile != true) {
    throw GradleException("Configured release keystore file does not exist.")
}

android {
    namespace = "com.marketcapsule.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.marketcapsule.app"
        manifestPlaceholders["capsuleAppLabel"] = "Market Capsule"
        minSdk = 26
        targetSdk = 36
        versionCode = 8
        versionName = "0.1.7-strike-ladder"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        if (releaseConfigured) {
            create("marketCapsuleRelease") {
                storeFile = releaseKeystorePath
                storePassword = releaseValues["MC_RELEASE_STORE_PASSWORD"]
                keyAlias = releaseValues["MC_RELEASE_KEY_ALIAS"]
                keyPassword = releaseValues["MC_RELEASE_KEY_PASSWORD"]
            }
        }
    }
    buildTypes {
        getByName("release") {
            // Parallel-install the first permanent app; never overwrite ephemeral debug-signed APKs.
            applicationIdSuffix = ".stable"
            manifestPlaceholders["capsuleAppLabel"] = "Market Capsule Stable"
            // Without valid credentials Gradle may package an unsigned variant locally,
            // but any assembleRelease/bundleRelease command above fails closed first.
            if (releaseConfigured) {
                signingConfig = signingConfigs.getByName("marketCapsuleRelease")
            }
        }
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    val bom = platform("androidx.compose:compose-bom:2025.10.01")
    implementation(bom)
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    androidTestImplementation(bom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
