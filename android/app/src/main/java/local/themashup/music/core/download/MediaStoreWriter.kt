package local.themashup.music.core.download

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
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

    fun save(context: Context, src: File, displayName: String, mime: String): Saved {
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
                    src.inputStream().use { it.copyTo(out) }
                } ?: throw IllegalStateException("could not open Downloads stream")
            } catch (e: Exception) {
                runCatching { resolver.delete(uri, null, null) }
                throw e
            }
            val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
            return Saved(name, uri.toString())
        }

        // API 26-28: try the public dir (works only with WRITE_EXTERNAL_STORAGE),
        // then fall back to the app-external Downloads folder.
        val publicDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            SUBDIR,
        )
        return try {
            publicDir.mkdirs()
            val out = File(publicDir, displayName)
            src.copyTo(out, overwrite = true)
            Saved(displayName, out.absolutePath)
        } catch (_: SecurityException) {
            val appDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: File(context.filesDir, "Downloads")
            appDir.mkdirs()
            val out = File(appDir, displayName)
            src.copyTo(out, overwrite = true)
            Saved(
                displayName,
                out.absolutePath,
                "Saved in the app folder — this Android version needs the storage " +
                    "permission for system Downloads.",
            )
        }
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
