package app.themashup.music.download

import android.content.Context
import android.os.Environment
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * JS-facing download API.
 *
 * Storage policy (docs/09 §5): app-private `Music/TheMashup/...` by default, with an optional public
 * Music directory. We never write to arbitrary paths supplied by the page — the filename is sanitised
 * and the directory is resolved here, so a hostile/buggy URL cannot escape the app sandbox.
 */
@CapacitorPlugin(name = "MashupDownloads")
class DownloadPlugin : Plugin() {

    @PluginMethod
    fun enqueue(call: PluginCall) {
        val url = call.getString("url")
        val fileName = call.getString("fileName")
        if (url.isNullOrBlank() || fileName.isNullOrBlank()) {
            call.reject("url and fileName are required")
            return
        }
        val id = call.getString("id") ?: System.currentTimeMillis().toString()
        val public = call.getBoolean("publicMusicDir") ?: false

        val dir = resolveDir(public, call.getString("subdir"))
        val safeName = sanitize(fileName)
        val dest = File(dir, safeName)

        val ctx = context
        val intent = DownloadService.intent(ctx, id, url, dest.absolutePath, safeName)
        ContextCompat.startForegroundService(ctx, intent)

        call.resolve(JSObject().put("id", id).put("path", dest.absolutePath))
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        val intent = android.content.Intent(context, DownloadService::class.java).apply {
            action = DownloadService.ACTION_CANCEL
            putExtra(DownloadService.EXTRA_ID, id)
        }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun list(call: PluginCall) {
        val root = File(resolveDir(false, null), "")
        val files = root.listFiles()?.filter { it.isFile }?.map {
            JSObject()
                .put("name", it.name)
                .put("path", it.absolutePath)
                .put("size", it.length())
        } ?: emptyList()
        call.resolve(JSObject().put("files", JSArray(files)))
    }

    private fun resolveDir(publicMusicDir: Boolean, subdir: String?): File {
        val base = if (publicMusicDir) {
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
        } else {
            File(context.filesDir, "Music")
        }
        val target = if (subdir.isNullOrBlank()) base else File(base, sanitize(subdir))
        if (!target.exists()) target.mkdirs()
        return target
    }

    /** Reject path traversal and characters that break on FAT/exFAT/SMB shares. */
    private fun sanitize(raw: String): String {
        val trimmed = raw.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_")
            .replace("..", "_")
            .trim()
            .trimEnd('.', ' ')
        return if (trimmed.isEmpty()) "untitled" else trimmed.take(180)
    }
}
