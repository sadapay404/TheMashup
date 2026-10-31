package local.themashup.music.core.download

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.download.logic.dedupeFilename

/**
 * Scoped-storage writer (docs N7): finished bytes land in
 * `MediaStore.Downloads` on Q+ — no storage permission. Below Q the public
 * Downloads dir needs WRITE_EXTERNAL_STORAGE (a runtime prompt we don't ask
 * for), so we fall back to the app-external dir with a job warning instead.
 */
object MediaStoreWriter {

    private const val SUBDIR = "TheMashup"

    data class Saved(
        /** Name shown in Downloads (possibly deduped with " (2)" suffix). */
        val displayName: String,
        /** Content URI (Q+) or absolute path below Q. */
        val location: String,
        /** Non-null when the file could not reach the SYSTEM Downloads dir. */
        val warning: String? = null,
    )

    fun save(
        context: Context,
        src: File,
        displayName: String,
        mime: String,
        checkCancelled: () -> Unit = {},
    ): Saved {
        checkCancelled()
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rel = "${Environment.DIRECTORY_DOWNLOADS}/$SUBDIR"
            val name = uniqueName(context, rel, displayName)
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, rel)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("MediaStore insert failed")
            try {
                resolver.openOutputStream(uri)?.use { out ->
                    src.inputStream().use { copyChecked(it, out, checkCancelled) }
                } ?: throw IllegalStateException("could not open Downloads stream")
                checkCancelled()
                val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                if (resolver.update(uri, done, null, null) <= 0) throw IOException("Could not publish downloaded file")
            } catch (e: Exception) {
                runCatching { resolver.delete(uri, null, null) }
                throw e
            }
            // Providers may rename on insert (e.g. concurrent duplicate names).
            val actualName = runCatching {
                resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }
            }.getOrNull() ?: name
            return Saved(actualName, uri.toString())
        }

        // API 26-28: try the public dir (works only with WRITE_EXTERNAL_STORAGE),
        // then fall back to the app-external Downloads folder.
        val publicDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            SUBDIR,
        )
        fun copyInto(dir: File, warning: String? = null): Saved {
            if (!dir.exists() && !dir.mkdirs()) throw IOException("Could not create download folder")
            val name = dedupeFilename(displayName, dir.list()?.toSet().orEmpty())
            val out = File(dir, name)
            try {
                if (!out.createNewFile()) throw kotlin.io.FileAlreadyExistsException(out)
                src.inputStream().use { input ->
                    out.outputStream().use { output -> copyChecked(input, output, checkCancelled) }
                }
            } catch (e: Exception) {
                // Don't remove an existing file if a concurrent download won the name.
                if (e !is kotlin.io.FileAlreadyExistsException) runCatching { out.delete() }
                throw e
            }
            return Saved(name, out.absolutePath, warning)
        }
        return try {
            copyInto(publicDir)
        } catch (_: SecurityException) {
            val appDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: File(context.filesDir, "Downloads")
            copyInto(appDir, "Saved in the app folder because public Downloads is not writable on this Android version.")
        } catch (_: IOException) {
            // Permission failures on API 26–28 are often FileNotFoundException,
            // not SecurityException. Still propagate failures from the fallback.
            val appDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: File(context.filesDir, "Downloads")
            copyInto(appDir, "Saved in the app folder because public Downloads is not writable on this Android version.")
        }
    }

    private fun copyChecked(input: InputStream, output: OutputStream, checkCancelled: () -> Unit) {
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            checkCancelled()
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
        }
        checkCancelled()
    }

    /** Best-effort cleanup of a file this invocation just created. */
    fun discard(context: Context, saved: Saved) {
        runCatching {
            if (saved.location.startsWith("content://")) context.contentResolver.delete(Uri.parse(saved.location), null, null)
            else File(saved.location).delete()
        }
    }

    /**
     * Resolve the URI saved by current builds or recover older completed rows
     * by their exact name and TheMashup folder. Run on an IO dispatcher.
     * Ambiguous matches are rejected rather than playing the wrong song.
     */
    fun findExisting(context: Context, job: DownloadJob): String? {
        fun readable(location: String): String? = runCatching {
            val uri = if (location.startsWith("/")) Uri.fromFile(File(location)) else Uri.parse(location)
            when (uri.scheme) {
                "content" -> context.contentResolver.openFileDescriptor(uri, "r")?.use { uri.toString() }
                "file" -> uri.path?.let(::File)?.takeIf { it.isFile && it.canRead() }?.let { uri.toString() }
                else -> null
            }
        }.getOrNull()

        job.location?.let { readable(it)?.let { found -> return found } }
        val name = job.filename?.takeIf { it.isNotBlank() && File(it).name == it } ?: return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rel = "${Environment.DIRECTORY_DOWNLOADS}/$SUBDIR/"
            val matches = mutableListOf<Uri>()
            runCatching {
                context.contentResolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Downloads._ID, MediaStore.Downloads.SIZE),
                    "${MediaStore.Downloads.DISPLAY_NAME}=? AND ${MediaStore.Downloads.RELATIVE_PATH}=? AND ${MediaStore.Downloads.IS_PENDING}=0",
                    arrayOf(name, rel),
                    null,
                )?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val size = if (cursor.isNull(1)) null else cursor.getLong(1)
                        if (job.filesize == null || size == null || size == job.filesize) {
                            matches += ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getLong(0))
                        }
                    }
                }
            }
            // The app has permission to access the MediaStore items it created.
            val readableMatches = matches.mapNotNull { readable(it.toString()) }.distinct()
            return readableMatches.singleOrNull()
        }

        val publicDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), SUBDIR)
        val appDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: File(context.filesDir, "Downloads")
        val dirs = if (job.warning != null) listOf(appDir, publicDir) else listOf(publicDir, appDir)
        val matches = dirs.map { File(it, name) }.filter {
            it.isFile && it.canRead() && (job.filesize == null || it.length() == job.filesize)
        }
        return matches.map { Uri.fromFile(it).toString() }.distinct().singleOrNull()
    }

    /** Display names already used in our Downloads subfolder (dedupe input). */
    private fun existingNames(context: Context, relPath: String): Set<String> {
        val out = mutableSetOf<String>()
        runCatching {
            context.contentResolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                arrayOf(MediaStore.Downloads.DISPLAY_NAME),
                "${MediaStore.Downloads.RELATIVE_PATH}=?",
                arrayOf("$relPath/"),
                null,
            )?.use { c ->
                val idx = c.getColumnIndex(MediaStore.Downloads.DISPLAY_NAME)
                while (c.moveToNext()) c.getString(idx)?.let { out += it }
            }
        }
        return out
    }

    private fun uniqueName(context: Context, relPath: String, name: String): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return name
        val taken = existingNames(context, relPath)
        if (taken.isEmpty()) return name
        return dedupeFilename(name, taken)
    }
}
