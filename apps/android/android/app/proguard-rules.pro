# Capacitor bridge + our plugins are reached reflectively.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class app.themashup.music.playback.MashupPlayerPlugin { *; }
-keep class app.themashup.music.download.DownloadPlugin { *; }
-keep class app.themashup.music.auth.AccountPlugin { *; }
-keep class app.themashup.music.extractor.generated.** { *; }
# Diagnostics is new and was missing from this list: R8 would rename the plugin class out from under
# Capacitor's reflective lookup, turning "read the crash log" into a crash of its own.
-keep class app.themashup.music.diagnostics.** { *; }

# Media3 is reflection-heavy in its session layer.
-keep class androidx.media3.session.** { *; }
-dontwarn androidx.media3.**

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# Keep line numbers so the on-device diagnostics ring buffer stays useful.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Crash readability ────────────────────────────────────────────────────────────────────────────
# A release crash must be diagnosable from logcat alone. Without these, every frame reads as
# `a.a.a(...)` and "instant crash on open" becomes undebuggable.
-keepattributes LineNumberTable,SourceFile,Exceptions,Signature,InnerClasses,EnclosingMethod
# Keep the entry point and the Capacitor bridge reachable from the manifest/reflection.
-keep class app.themashup.music.MainActivity { *; }
-keep class app.themashup.music.BuildConfigStreamExtractorDelegate { *; }
-keep class app.themashup.music.extractor.Extractor { *; }
-keep interface app.themashup.music.extractor.StreamExtractor { *; }
# Tink (pulled in by security-crypto) locates provider primitives reflectively; stripping them makes
# EncryptedSharedPreferences throw the first time it is touched.
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**
# Kotlin coroutines / serialization metadata used reflectively at runtime.
-keepclassmembers class kotlin.Metadata { *; }
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**
