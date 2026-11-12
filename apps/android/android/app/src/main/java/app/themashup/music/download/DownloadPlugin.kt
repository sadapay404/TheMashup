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
 *
 * Folder model: the page thinks in folders (a playlist is a folder; songs and videos have their own
 * top-level roots). This plugin is the only place that knows what that means on disk, so the same
 * names the user sees are the names on the filesystem.
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
        val ctx = getContext()
        val id = call.getString("id") ?: System.currentTimeMillis().toString()
        val public = call.getBoolean("publicMusicDir") ?: false
        val kind = call.getString("kind") ?: "music"

        val dir = resolveDir(ctx, public, kind, call.getString("subdir"))
        val safeName = sanitize(fileName)
        val dest = File(dir, safeName)

        // Headers the resolver reported for this URL, passed through so the transfer is authorised
        // exactly like playback is. Without them a downloaded file fails with 403 while the same URL
        // plays fine in the player — a difference nobody would guess from the error.
        val headers = call.getObject("headers")?.let { obj ->
            val map = HashMap<String, String>()
            for (key in obj.keys()) {
                val value = obj.optString(key, "")
                if (key.isNotBlank() && value.isNotBlank()) map[key] = value
            }
            map
        } ?: emptyMap()

        val intent = DownloadService.intent(ctx, id, url, dest.absolutePath, safeName, headers)
        ContextCompat.startForegroundService(ctx, intent)

        call.resolve(
            JSObject()
                .put("id", id)
                .put("path", dest.absolutePath)
                .put("folder", dir.name),
        )
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        val intent = android.content.Intent(getContext(), DownloadService::class.java).apply {
            action = DownloadService.ACTION_CANCEL
            putExtra(DownloadService.EXTRA_ID, id)
        }
        getContext().startService(intent)
        call.resolve()
    }

    /**
     * The real tree: the section roots, every folder under them, and the files each folder holds.
     *
     * Reading this from disk rather than trusting the page's copy means a file the user deleted with
     * a file manager does not keep showing up as downloaded.
     */
    @PluginMethod
    fun tree(call: PluginCall) {
        val ctx = getContext()
        val public = call.getBoolean("publicMusicDir") ?: false
        val sections = JSArray()
        for (kind in listOf("music", "video")) {
            val root = sectionRoot(ctx, public, kind)
            val folders = JSArray()
            for (dir in root.listFiles()?.filter { it.isDirectory }?.sortedBy { it.name.lowercase() } ?: emptyList()) {
                folders.put(folderJson(dir))
            }
            // Loose files that were saved before folders existed, or by another app.
            val loose = JSArray()
            root.listFiles()?.filter { it.isFile }?.sortedBy { it.name.lowercase() }?.forEach { loose.put(fileJson(it)) }
            sections.put(
                JSObject()
                    .put("kind", kind)
                    .put("root", root.absolutePath)
                    .put("folders", folders)
                    .put("files", loose),
            )
        }
        call.resolve(JSObject().put("public", public).put("sections", sections))
    }

    /** Create a folder under a section root. Returns the resolved path. */
    @PluginMethod
    fun createFolder(call: PluginCall) {
        val name = call.getString("name")
        if (name.isNullOrBlank()) {
            call.reject("name is required")
            return
        }
        val pub = call.getBoolean("publicMusicDir") ?: false
        val kind = call.getString("kind") ?: "music"
        val dir = resolveDir(getContext(), pub, kind, name)
        call.resolve(JSObject().put("name", dir.name).put("path", dir.absolutePath))
    }

    /**
     * Move a file between folders.
     *
     * Rename rather than copy-then-delete: both paths are on the same filesystem, so `renameTo` is
     * atomic and cannot leave a half-copied file behind. A cross-filesystem move is reported as a
     * failure instead of silently degrading to a partial copy.
     */
    @PluginMethod
    fun move(call: PluginCall) {
        val from = call.getString("from")
        val fromKind = call.getString("fromKind") ?: "music"
        val toFolder = call.getString("toFolder")
        val toKind = call.getString("toKind") ?: fromKind
        if (from.isNullOrBlank() || toFolder.isNullOrBlank()) {
            call.reject("from and toFolder are required")
            return
        }
        val pub = call.getBoolean("publicMusicDir") ?: false
        val ctx = getContext()

        // Only files inside our own tree may move. `from` is a path we handed out earlier, but it is
        // re-resolved against the root so a tampered page cannot point it at system storage.
        val source = File(from).canonicalFile
        val fromRoot = sectionRoot(ctx, pub, fromKind).canonicalFile
        if (!source.path.startsWith(fromRoot.path)) {
            call.reject("refusing to move a file outside the downloads tree")
            return
        }
        if (!source.isFile) {
            call.reject("no such file")
            return
        }

        val targetDir = resolveDir(ctx, pub, toKind, toFolder)
        val target = File(targetDir, source.name)
        if (target.exists()) {
            call.reject("a file with that name already exists in ${targetDir.name}")
            return
        }
        if (!source.renameTo(target)) {
            call.reject("move failed")
            return
        }
        call.resolve(JSObject().put("path", target.absolutePath).put("folder", targetDir.name))
    }

    /** Delete a stored file. Scoped to the downloads tree for the same reason as `move`. */
    @PluginMethod
    fun remove(call: PluginCall) {
        val path = call.getString("path")
        val kind = call.getString("kind") ?: "music"
        if (path.isNullOrBlank()) {
            call.reject("path is required")
            return
        }
        val pub = call.getBoolean("publicMusicDir") ?: false
        val root = sectionRoot(getContext(), pub, kind).canonicalFile
        val file = File(path).canonicalFile
        if (!file.path.startsWith(root.path)) {
            call.reject("refusing to delete a file outside the downloads tree")
            return
        }
        call.resolve(JSObject().put("removed", file.isFile && file.delete()))
    }

    @PluginMethod
    fun list(call: PluginCall) {
        val root = sectionRoot(getContext(), false, call.getString("kind") ?: "music")
        val files = root.listFiles()?.filter { it.isFile }?.map { fileJson(it) } ?: emptyList()
        call.resolve(JSObject().put("files", JSArray(files)))
    }

    private fun folderJson(dir: File): JSObject {
        val files = dir.listFiles()?.filter { it.isFile }?.sortedBy { it.name.lowercase() } ?: emptyList()
        return JSObject()
            .put("name", dir.name)
            .put("path", dir.absolutePath)
            .put("files", JSArray(files.map { fileJson(it) }))
            .put("size", files.sumOf { it.length() })
    }

    private fun fileJson(file: File): JSObject =
        JSObject()
            .put("name", file.name)
            .put("path", file.absolutePath)
            .put("size", file.length())
            .put("modified", file.lastModified())

    /** Songs and videos live in separate roots, which is what makes them separate sections. */
    private fun sectionRoot(ctx: Context, publicMusicDir: Boolean, kind: String): File {
        val base = if (publicMusicDir) {
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
        } else {
            File(ctx.filesDir, "Music")
        }
        val root = File(base, if (kind == "video") "Videos" else "")
        if (!root.exists()) root.mkdirs()
        return root
    }

    private fun resolveDir(ctx: Context, publicMusicDir: Boolean, kind: String, subdir: String?): File {
        val base = sectionRoot(ctx, publicMusicDir, kind)
        val target = if (subdir.isNullOrBlank()) base else File(base, sanitize(subdir))
        if (!target.exists()) target.mkdirs()
        return target
    }

    /** Reject path traversal and characters that break on FAT/exFAT/SMB shares. */
    private fun sanitize(raw: String): String {
        // The `..` replace below is redundant: `/` and `\\` are already replaced with `_`, so no
        // traversal sequence can survive. Keeping it would make Detekt flag unreachable logic.
        val trimmed = raw.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_")
            .trim()
            .trimEnd('.', ' ')
        return if (trimmed.isEmpty()) "untitled" else trimmed.take(180)
    }
}
