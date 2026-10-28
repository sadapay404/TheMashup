# TheMashup — keep serialization models (kotlinx) reachable by R8.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class local.themashup.music.** {
    *** Companion;
}
-keepclasseswithmembers class local.themashup.music.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# NewPipe Extractor ships service JSON parsers accessed reflectively in spots.
-keep class org.schabi.newpipe.** { *; }
-dontwarn org.schabi.newpipe.**
# NewPipeExtractor README (needed by its JavaScript engine used for signatures).
-keep class org.mozilla.javascript.** { *; }
-keep class org.mozilla.classfile.ClassFileWriter
-dontwarn org.mozilla.javascript.tools.**

# OkHttp platform
-dontwarn okhttp3.**
-dontwarn okio.**
