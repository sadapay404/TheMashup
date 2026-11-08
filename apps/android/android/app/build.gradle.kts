plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.themashup.music"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.themashup.music"
        minSdk = 26            // Media3 + EncryptedSharedPreferences floor
        targetSdk = 35
        versionCode = 2
        versionName = "0.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        resourceConfigurations += listOf("en", "ur", "hi", "ar")
    }

    signingConfigs {
        // Populated from CI secrets; falls back to debug signing for local builds so the project
        // always assembles. Never commit a real keystore (see docs/03 §4 and CI workflow).
        create("release") {
            val storePath = System.getenv("MASHUP_KEYSTORE_PATH")
            if (storePath != null && java.io.File(storePath).exists()) {
                storeFile = java.io.File(storePath)
                storePassword = System.getenv("MASHUP_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MASHUP_KEY_ALIAS") ?: "themashup"
                keyPassword = System.getenv("MASHUP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val hasRelease = System.getenv("MASHUP_KEYSTORE_PATH") != null
            signingConfig = if (hasRelease) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf("-opt-in=kotlin.RequiresOptIn")
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/LICENSE*",
            "META-INF/NOTICE*",
            "META-INF/*.kotlin_module",
            "kotlin/**",
        )
    }

    // Two flavours implement ADR-005: the default ships zero GPL code.
    flavorDimensions += "extractor"
    productFlavors {
        create("standard") {
            dimension = "extractor"
        }
        create("withNativeExtractor") {
            dimension = "extractor"
            // Only this flavour adds the GPL extractor dependency and its attribution screen.
            versionNameSuffix = "-gpl"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")

    // Capacitor shell
    implementation("com.capacitorjs:core:6.1.2")
    implementation("androidx.webkit:webkit:1.11.0")

    // Playback: Media3 (session service, notification, lockscreen, media keys, audio focus)
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-session:1.4.1")
    implementation("androidx.media3:media3-datasource-okhttp:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")

    // Networking for the downloader
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.8.1")

    // Keystore-backed cookie storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Optional GPL extractor — resolved only in the enhanced flavour.
    "withNativeExtractorImplementation"("com.github.TeamNewPipe:NewPipeExtractor:v0.24.6")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
