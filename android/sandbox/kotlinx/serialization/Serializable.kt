// Sandbox-only stub of kotlinx.serialization.Serializable so the pure-Kotlin
// domain sources compile without the serialization runtime jar (which is not
// fetchable from the sandbox's allowed hosts). Gradle uses the real
// annotation + compiler plugin from libs.versions.toml.
@file:Suppress("unused")

package kotlinx.serialization

@Target(
    AnnotationTarget.CLASS,
    AnnotationTarget.PROPERTY,
    AnnotationTarget.TYPE,
)
annotation class Serializable
