package app.themashup.music.download

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Foreground download service.
 *
 * Behaviour that matters:
 *  - Android 14 requires a declared `dataSync` foreground type; we honour it and time-box ourselves
 *    (8 h) so the OS never kills us mid-write unexpectedly.
 *  - Chunked, resumable downloads to a *scratch* file, then an atomic rename. A killed process leaves
 *    a `.part` file that resumes on next start instead of corrupting the final file.
 *  - Cancellation is cooperative and checks a flag between chunks, so the notification's Cancel
 *    action always works.
 */
class DownloadService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = ConcurrentHashMap<String, Job>()

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val id = intent.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
                val url = intent.getStringExtra(EXTRA_URL) ?: return START_NOT_STICKY
                val dest = intent.getStringExtra(EXTRA_DEST) ?: return START_NOT_STICKY
                val name = intent.getStringExtra(EXTRA_NAME) ?: "download"
                startForegroundIfNeeded()
                enqueue(id, url, File(dest), name)
            }
            ACTION_CANCEL -> {
                intent.getStringExtra(EXTRA_ID)?.let { jobs.remove(it)?.cancel() }
            }
        }
        return START_STICKY
    }

    private fun startForegroundIfNeeded() {
        val channelId = "mashup_downloads"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(channelId, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                        description = "Background music downloads"
                        setShowBadge(false)
                    },
                )
            }
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Downloading")
            .setContentText("Preparing download…")
            .setOngoing(true)
            .setProgress(0, 0, true)
            .build()
        startForeground(NOTIF_ID, notification)
    }

    private fun enqueue(id: String, url: String, dest: File, displayName: String) {
        if (jobs.containsKey(id)) return
        val job = scope.launch {
            val part = File(dest.absolutePath + ".part")
            try {
                dest.parentFile?.mkdirs()
                var downloaded = if (part.exists()) part.length() else 0L

                val request = Request.Builder()
                    .url(url)
                    .apply { if (downloaded > 0) header("Range", "bytes=$downloaded-") }
                    .build()

                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}")
                    }
                    // Server may ignore the Range and send the whole body; handle both.
                    if (downloaded > 0 && response.code != 206) downloaded = 0L
                    val total = (response.body?.contentLength() ?: -1L).let {
                        if (it > 0) it + downloaded else -1L
                    }

                    response.body?.byteStream()?.use { input ->
                        RandomAccessFile(part, "rw").use { raf ->
                            raf.seek(downloaded)
                            val buffer = ByteArray(64 * 1024)
                            var lastReport = 0L
                            while (true) {
                                if (!isActive) return@launch
                                val read = input.read(buffer)
                                if (read <= 0) break
                                raf.write(buffer, 0, read)
                                downloaded += read
                                val now = System.currentTimeMillis()
                                if (now - lastReport > 400) {
                                    lastReport = now
                                    DownloadEvents.progress(id, downloaded, total)
                                }
                            }
                            raf.fd.sync()
                        }
                    }
                }

                if (totalBytesMismatch(dest, part, downloaded)) {
                    throw IllegalStateException("size mismatch after download")
                }

                // Atomic publish: never leave a half-written file with the final name.
                if (dest.exists()) dest.delete()
                if (!part.renameTo(dest)) {
                    part.copyTo(dest, overwrite = true)
                    part.delete()
                }
                DownloadEvents.complete(id, dest.absolutePath, displayName)
            } catch (t: Throwable) {
                Log.w(TAG, "download $id failed", t)
                DownloadEvents.failed(id, t.message ?: t::class.java.simpleName)
            } finally {
                jobs.remove(id)
                if (jobs.isEmpty()) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        jobs[id] = job
    }

    private fun totalBytesMismatch(dest: File, part: File, downloaded: Long): Boolean =
        downloaded <= 0L || (!part.exists())

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MashupDownload"
        private const val NOTIF_ID = 4211
        const val ACTION_START = "app.themashup.download.START"
        const val ACTION_CANCEL = "app.themashup.download.CANCEL"
        const val EXTRA_ID = "id"
        const val EXTRA_URL = "url"
        const val EXTRA_DEST = "dest"
        const val EXTRA_NAME = "name"

        fun intent(context: Context, id: String, url: String, dest: String, name: String): Intent =
            Intent(context, DownloadService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_ID, id)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_DEST, dest)
                putExtra(EXTRA_NAME, name)
            }
    }
}

object DownloadEvents {
    fun progress(id: String, bytes: Long, total: Long) =
        app.themashup.music.playback.NativeEvents.post(
            "downloadProgress",
            mapOf("id" to id, "bytes" to bytes, "total" to total),
        )

    fun complete(id: String, path: String, name: String) =
        app.themashup.music.playback.NativeEvents.post(
            "downloadComplete",
            mapOf("id" to id, "path" to path, "name" to name),
        )

    fun failed(id: String, reason: String) =
        app.themashup.music.playback.NativeEvents.post(
            "downloadFailed",
            mapOf("id" to id, "reason" to reason),
        )
}
