# Capacitor bridge + our plugins are reached reflectively.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class app.themashup.music.playback.MashupPlayerPlugin { *; }
-keep class app.themashup.music.download.DownloadPlugin { *; }
-keep class app.themashup.music.auth.AccountPlugin { *; }
-keep class app.themashup.music.extractor.generated.** { *; }

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
