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

# ── GPL extractor: never linked into the standard APK ────────────────────────────────────────────
# The source set does not exist in the `standard` flavour, so there is nothing to link. These rules
# are for the *enhanced* flavour, where the class and NewPipeExtractor are reached by name and by
# reflection, and for the standard flavour's harmless-but-real Class.forName string reference (which
# R8 resolves to a null constant, not a linkage).
-keep class app.themashup.music.extractor.generated.** { *; }
-keep class app.themashup.music.extractor.Extractor { *; }
-keep interface app.themashup.music.extractor.StreamExtractor { *; }
-keep class app.themashup.music.extractor.ExtractorPlugin { *; }

# NewPipeExtractor ships proguard rules of its own, but they are read from the AAR/JAR metadata which
# R8 applies *before* ours; Rhino's classfile writer is the commonly-missed one (it is loaded by name
# from interpreted JavaScript).
-keep class org.mozilla.javascript.** { *; }
-keep class org.mozilla.classfile.ClassFileWriter
-dontwarn org.mozilla.javascript.tools.**
-dontwarn org.schabi.newpipe.extractor.**

# Rhino references the *desktop* JDK's scripting and bean APIs for pieces of its engine this app never
# calls (`RhinoScriptEngine`, `JavaToJSONConverters`). Android has no javax.script and no java.beans,
# so R8 reports them as missing and — because minification runs in full mode — fails the build rather
# than the class load. R8 was the first thing to see this: the error surfaces only after Kotlin has
# compiled cleanly, which is why it appeared one step later than the earlier failures.
-dontwarn javax.script.**
-dontwarn java.beans.**

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
