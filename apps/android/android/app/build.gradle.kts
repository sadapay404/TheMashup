plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.themashup.music"
    compileSdk = rootProject.ext.get("compileSdkVersion") as Int

    defaultConfig {
        applicationId = "app.themashup.music"
        minSdk = rootProject.ext.get("minSdkVersion") as Int
        targetSdk = rootProject.ext.get("targetSdkVersion") as Int
        versionCode = 3
        versionName = "0.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Keep the packaged web assets lean; the pattern mirrors Capacitor's own default.
        androidResources {
            ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
        }
    }

    signingConfigs {
        // CI provides these; local builds fall back to the debug key so the project always assembles.
        create("release") {
            val storePath = System.getenv("MASHUP_KEYSTORE_PATH")
            if (storePath != null && file(storePath).exists()) {
                storeFile = file(storePath)
                storePassword = System.getenv("MASHUP_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MASHUP_KEY_ALIAS") ?: "themashup"
                keyPassword = System.getenv("MASHUP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            // Resource shrinking was on with no keep rules. Capacitor resolves its own web assets and
            // plugin resources by name at runtime, which is precisely what the shrinker cannot see.
            // The APK crashed on launch; a minified build that cannot start is not a smaller build,
            // it is a broken one. Turned off deliberately rather than papered over with keep rules
            // that would have to enumerate assets that do not exist yet.
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val signed = System.getenv("MASHUP_KEYSTORE_PATH") != null
            signingConfig = if (signed) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
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
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/LICENSE*",
            "META-INF/NOTICE*",
        )
    }

    // ADR-005: the default artefact contains no GPL code.
    flavorDimensions += "extractor"
    productFlavors {
        create("standard") {
            dimension = "extractor"
        }
        create("withNativeExtractor") {
            dimension = "extractor"
            versionNameSuffix = "-gpl"
        }
    }
}

dependencies {
    implementation(fileTree(mapOf("include" to listOf("*.jar"), "dir" to "libs")))

    implementation("androidx.appcompat:appcompat:${rootProject.ext["androidxAppCompatVersion"]}")
    implementation("androidx.coordinatorlayout:coordinatorlayout:${rootProject.ext["androidxCoordinatorLayoutVersion"]}")
    implementation("androidx.core:core-splashscreen:${rootProject.ext["coreSplashScreenVersion"]}")
    implementation("androidx.core:core-ktx:${rootProject.ext["androidxCoreVersion"]}")
    implementation("androidx.webkit:webkit:${rootProject.ext["androidxWebkitVersion"]}")

    // Capacitor: a Gradle source module, wired up by capacitor.settings.gradle.
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-cordova-android-plugins"))

    // Background playback: Media3 session service, notification, lockscreen + media keys.
    val media3 = rootProject.ext["media3Version"]
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-session:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("androidx.media3:media3-ui:$media3")

    // Downloader + coroutines
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Keystore-backed session storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // GPL extractor — resolved only for the enhanced flavour.
    // Optional GPL extractor. NewPipe publishes to JitPack; the enhanced flavour is built separately.
    "withNativeExtractorImplementation"("com.github.TeamNewPipe:NewPipeExtractor:v0.24.6")

    testImplementation("junit:junit:${rootProject.ext["junitVersion"]}")
    androidTestImplementation("androidx.test.ext:junit:${rootProject.ext["androidxJunitVersion"]}")
    androidTestImplementation("androidx.test.espresso:espresso-core:${rootProject.ext["androidxEspressoCoreVersion"]}")
}

apply(from = "capacitor.build.gradle")
