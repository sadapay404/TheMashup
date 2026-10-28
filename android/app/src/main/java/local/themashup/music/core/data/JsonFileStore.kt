package local.themashup.music.core.data

import java.io.File
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/**
 * Atomic JSON file store — the native port of the web gateway's local
 * `data/library.json` fallback (no Room/KSP toolchain risk; personal-scale
 * data, full test coverage on the JVM via `./gradlew test`).
 *
 * - Reads/writes are serialized behind a [Mutex].
 * - Writes go to a temp file then rename (crash-safe).
 * - Corrupt files are moved aside (`*.bak`) and the default is returned, so
 *   a bad sector never bricks the library.
 */
class JsonFileStore<T>(
    private val file: File,
    private val serializer: KSerializer<T>,
    private val defaults: () -> T,
) {
    private val mutex = Mutex()
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }

    suspend fun read(): T = mutex.withLock { readLocked() }

    suspend fun write(value: T): Unit = mutex.withLock { writeLocked(value) }

    /** Read-modify-write under a single lock. */
    suspend fun update(fn: (T) -> T): T = mutex.withLock {
        val next = fn(readLocked())
        writeLocked(next)
        next
    }

    private fun readLocked(): T {
        if (!file.exists()) return defaults()
        return try {
            json.decodeFromString(serializer, file.readText())
        } catch (_: Exception) {
            try {
                file.copyTo(File(file.parentFile, file.name + ".bak"), overwrite = true)
            } catch (_: Exception) {
                /* best effort */
            }
            defaults()
        }
    }

    private fun writeLocked(value: T) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(json.encodeToString(serializer, value))
        if (!tmp.renameTo(file)) {
            // Fallback for filesystems that refuse overwriting rename.
            file.delete()
            tmp.renameTo(file)
        }
    }
}
