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
        // Derived from the tag, so a log or an installed APK can always be traced to a commit.
        // These were hard-coded to 3 / "0.3.0", which meant every diagnostic report said
        // "build: 0.3.0 (3)" no matter which APK produced it - genuinely ambiguous when several
        // builds are in flight, and it cost time finding that out.
        //
        // MASHUP_VERSION_CODE / MASHUP_VERSION_NAME come from the CI tag (v0.3.0-apk.31 -> 31).
        // Local builds fall back to 1 / "dev" so the project still assembles without them.
        versionCode = (System.getenv("MASHUP_VERSION_CODE") ?: "1").toIntOrNull() ?: 1
        versionName = System.getenv("MASHUP_VERSION_NAME") ?: "dev"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Keep the packaged web assets lean; the pattern mirrors Capacitor's own default.
        androidResources {
            ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
        }
    }

    signingConfigs {
        /*
         * One key, committed, so builds install over each other.
         *
         * Every CI runner generated its own debug key, so every APK had a different signature and
         * Android refused to install it over the previous one ("App not installed") — the user had to
         * uninstall first, every single release. A committed keystore ends that permanently.
         *
         * This is a key for an open-source, sideloaded app distributed as a GitHub release. There is no
         * Play Store identity to protect and no secret being leaked: anybody can rebuild the APK from
         * this repository anyway. The environment variables still win when present, so a future
         * properly-secret key can be dropped in without touching this file.
         */
        create("release") {
            /*
             * The committed key wins.
             *
             * Deliberately the reverse of the usual precedence. A leftover CI secret would otherwise
             * silently sign with a key nobody can reproduce locally, and the whole point of committing
             * one is that every build — CI, a laptop, a fork — is signed identically. The environment
             * still applies when the committed key is absent, so a project that must keep its key
             * secret can drop it in and delete the committed one.
             */
            val committed = rootProject.file("../keys/themashup.p12")
            val envPath = System.getenv("MASHUP_KEYSTORE_PATH")
            val storePath = if (committed.exists()) committed.absolutePath
                            else if (envPath != null && file(envPath).exists()) envPath
                            else committed.absolutePath
            if (file(storePath).exists()) {
                storeFile = file(storePath)
                storePassword = System.getenv("MASHUP_KEYSTORE_PASSWORD") ?: "themashup123"
                keyAlias = System.getenv("MASHUP_KEY_ALIAS") ?: "themashup"
                keyPassword = System.getenv("MASHUP_KEY_PASSWORD") ?: "themashup123"
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
            /*
             * Release is now always signed with the release key (env-provided or committed), so the
             * debug fallback only applies when no key exists at all — which is a broken checkout, not
             * a normal state.
             */
            val hasKey = rootProject.file("../keys/themashup.p12").exists() ||
                System.getenv("MASHUP_KEYSTORE_PATH") != null
            signingConfig = if (hasKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
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
        /*
         * Required by NewPipeExtractor, not a preference.
         *
         * NewPipeExtractor's README is explicit: on a `minSdk` below 33 it needs core library
         * desugaring with the `desugar_jdk_libs_nio` artifact. Without it the enhanced flavour either
         * fails to dex (missing `java.nio` members) or crashes at runtime the first time the
         * extractor touches a stream. The `_nio` variant is the one it asks for specifically.
         *
         * Enabled for both flavours rather than only the GPL one: a build shape that differs between
         * flavours is one more way for the APK the user installs to be the one nobody tested.
         */
        isCoreLibraryDesugaringEnabled = true
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

    // Core library desugaring for NewPipeExtractor (see compileOptions above).
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")

    /*
     * The GPL extractor.
     *
     * v0.27.1 is the release NewPipe itself ships (2026-11-10), and the only version whose YouTube
     * client table matches what YouTube is serving today — which is the whole point of taking the
     * dependency. The previous pin, v0.24.6, was roughly a year behind.
     *
     * JitPack builds it from the tag on first request, which is less reliable than a hosted
     * repository but is the coordinate NewPipeExtractor documents and maintains.
     *
     * `kotlinx-serialization-json` is NOT here: it was never needed by this class (it parses through
     * org.json) and adding an unused runtime dependency to a GPL APK is just more surface to break.
     */
    "withNativeExtractorImplementation"("com.github.TeamNewPipe:NewPipeExtractor:v0.27.1")

    testImplementation("junit:junit:${rootProject.ext["junitVersion"]}")
    androidTestImplementation("androidx.test.ext:junit:${rootProject.ext["androidxJunitVersion"]}")
    androidTestImplementation("androidx.test.espresso:espresso-core:${rootProject.ext["androidxEspressoCoreVersion"]}")
}

apply(from = "capacitor.build.gradle")
