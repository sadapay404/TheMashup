package local.themashup.music.core.data

import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
 * - Writes go to a temp file then an atomic same-directory rename; a failure
 *   is reported rather than deleting the previous document.
 * - Invalid JSON is backed up (`*.bak`) before returning defaults. A read I/O
 *   failure is propagated rather than being mistaken for corrupt data.
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

    // Callers include Compose click handlers. Keep JSON parsing and filesystem
    // reads/writes off the UI thread even when the caller is on Dispatchers.Main.
    suspend fun read(): T = withContext(Dispatchers.IO) { mutex.withLock { readLocked() } }

    suspend fun write(value: T): Unit = withContext(Dispatchers.IO) { mutex.withLock { writeLocked(value) } }

    /** Read-modify-write under a single lock. */
    suspend fun update(fn: (T) -> T): T = withContext(Dispatchers.IO) {
        mutex.withLock {
            val next = fn(readLocked())
            writeLocked(next)
            next
        }
    }

    private fun readLocked(): T {
        if (!file.exists()) return defaults()
        // Do not replace data with defaults when the filesystem itself fails.
        val contents = file.readText()
        return try {
            json.decodeFromString(serializer, contents)
        } catch (_: IllegalArgumentException) {
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
            // Never delete the previous document in a failed overwrite attempt.
            throw IOException("Could not replace ${file.name} with its temporary file")
        }
    }
}
