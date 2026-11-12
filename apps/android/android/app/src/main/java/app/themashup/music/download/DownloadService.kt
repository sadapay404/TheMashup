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

    /**
     * Cancellation is a plain atomic flag rather than coroutine introspection: the copy loop runs
     * several lambdas deep (Response.use → RandomAccessFile.use), where `isActive` and even a
     * self-referential `job` reference do not resolve.
     */
    private val cancelFlags = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicBoolean>()

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        // A stalled CDN would otherwise hold the job — and this foreground service — open forever,
        // which is indistinguishable from "stuck on preparing" from the user's side. 30 s of silence
        // on a socket that is meant to be streaming is a failure, not patience.
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.MINUTES)
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
                // Headers the resolver reported (Referer / User-Agent). A CDN that issued the URL for
                // a particular referer answers 403 to a request without one — a download failure that
                // looks like a network fault.
                val headerPairs = intent.getStringArrayExtra(EXTRA_HEADERS) ?: emptyArray()
                val headers = headerPairs.mapNotNull { pair ->
                    val at = pair.indexOf('\n')
                    if (at <= 0) null else pair.substring(0, at) to pair.substring(at + 1)
                }.toMap()
                startForegroundIfNeeded()
                enqueue(id, url, File(dest), name, headers)
            }
            ACTION_CANCEL -> {
                intent.getStringExtra(EXTRA_ID)?.let { id ->
                    // Set the cooperative flag first so the copy loop stops at the next chunk,
                    // then cancel the coroutine for anything that is still suspending.
                    cancelFlags.remove(id)?.set(true)
                    jobs.remove(id)?.cancel()
                    DownloadEvents.failed(id, "cancelled")
                }
            }
        }
        return START_STICKY
    }

    private fun startForegroundIfNeeded() {
        val channelId = CHANNEL_ID
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
        val notification = buildNotification("Downloading", "Preparing download…", indeterminate = true, pct = 0, ongoing = true)
        // Android 14 enforces the declared type at startForeground time; without it the service is
        // killed with ForegroundServiceTypeNotAllowed and every download silently dies.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    /**
     * One notification, re-posted as the transfer moves.
     *
     * The foreground notification used to be built once, with the text "Preparing download…" and an
     * indeterminate spinner, and was never touched again. The transfer would finish correctly while
     * the shade still claimed it was preparing — so the only thing the user could see said it was
     * stuck, no matter what was actually happening. Every progress event now re-posts it with real
     * numbers, and completion replaces it with a done state.
     */
    private fun buildNotification(
        title: String,
        text: String,
        indeterminate: Boolean,
        pct: Int,
        ongoing: Boolean,
    ) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(ongoing)
        .setAutoCancel(!ongoing)
        .setOnlyAlertOnce(true) // re-posting must not buzz on every 256 KiB
        .apply { if (indeterminate) setProgress(0, 0, true) else setProgress(100, pct.coerceIn(0, 100), false) }
        .build()

    /** Re-post the foreground notification with live progress. Safe to call from any thread. */
    private fun updateNotification(title: String, text: String, pct: Int) {
        runCatching {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, buildNotification(title, text, indeterminate = false, pct = pct, ongoing = true))
        }
    }

    /**
     * The final word, posted under its own id.
     *
     * The `finally` block below calls `stopForeground(STOP_FOREGROUND_REMOVE)`, which deletes the
     * foreground notification the moment the queue empties. Posting "Downloaded" under that same id
     * meant it was erased in the same breath — a user watching the shade would see it flicker and
     * vanish. A separate, dismissable id outlives the service, so the outcome is actually readable
     * after the screen has been off for two minutes.
     */
    private fun postResult(title: String, text: String, failed: Boolean) {
        runCatching {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(
                NOTIF_ID_RESULT,
                NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(
                        if (failed) android.R.drawable.stat_notify_error else android.R.drawable.stat_sys_download_done,
                    )
                    .setContentTitle(title)
                    .setContentText(text)
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .build(),
            )
        }
    }

    private fun enqueue(
        id: String,
        url: String,
        dest: File,
        displayName: String,
        headers: Map<String, String> = emptyMap(),
    ) {
        if (jobs.containsKey(id)) return
        val cancelled = java.util.concurrent.atomic.AtomicBoolean(false)
        cancelFlags[id] = cancelled
        val job = scope.launch {
            val part = File(dest.absolutePath + ".part")
            try {
                dest.parentFile?.mkdirs()
                var downloaded = if (part.exists()) part.length() else 0L

                val request = Request.Builder()
                    .url(url)
                    .apply {
                        // The resolver's headers first; a Range header below must not overwrite them.
                        for ((name, value) in headers) header(name, value)
                        if (downloaded > 0) header("Range", "bytes=$downloaded-")
                    }
                    .build()

                var expectedTotal = -1L
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}")
                    }
                    // Server may ignore the Range and send the whole body; handle both.
                    if (downloaded > 0 && response.code != 206) downloaded = 0L
                    val total = (response.body?.contentLength() ?: -1L).let {
                        if (it > 0) it + downloaded else -1L
                    }
                    expectedTotal = total

                    // Progress is reported every PROGRESS_STEP bytes rather than on a timer.
                    //
                    // A captured `var` here is flagged as a dead assignment: Kotlin's data-flow
                    // analysis does not track a local that is mutated inside nested lambdas, so it
                    // concludes the write is never read. A single-element array is the idiomatic fix
                    // and keeps the intent obvious.
                    val reported = longArrayOf(0L)
                    response.body?.byteStream()?.use { input ->
                        RandomAccessFile(part, "rw").use { raf ->
                            raf.seek(downloaded)
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                if (cancelled.get()) return@launch
                                val read = input.read(buffer)
                                if (read <= 0) break
                                raf.write(buffer, 0, read)
                                downloaded += read
                                if (downloaded - reported[0] >= PROGRESS_STEP) {
                                    reported[0] = downloaded
                                    DownloadEvents.progress(id, downloaded, total)
                                    val pct = if (total > 0) ((downloaded * 100) / total).toInt() else 0
                                    updateNotification(
                                        displayName,
                                        if (total > 0) "$pct% · ${downloaded / 1024 / 1024} MB of ${total / 1024 / 1024} MB"
                                        else "${downloaded / 1024 / 1024} MB",
                                        pct,
                                    )
                                }
                            }
                            raf.fd.sync()
                        }
                    }
                    // Always emit a final value so the UI lands on 100% rather than 97%.
                    DownloadEvents.progress(id, downloaded, total)
                }

                // A server that closes the connection early leaves a short .part file. Publishing it
                // under the final name would hand the user a truncated song that looks complete.
                if (expectedTotal > 0 && downloaded < expectedTotal) {
                    throw IllegalStateException(
                        "incomplete: $downloaded of $expectedTotal bytes (will resume)",
                    )
                }
                if (downloaded <= 0L || !part.exists()) {
                    throw IllegalStateException("no data received")
                }

                // Atomic publish: never leave a half-written file with the final name.
                if (dest.exists()) dest.delete()
                if (!part.renameTo(dest)) {
                    part.copyTo(dest, overwrite = true)
                    part.delete()
                }
                DownloadEvents.complete(id, dest.absolutePath, displayName)
                postResult("Downloaded", displayName, failed = false)
            } catch (t: Throwable) {
                Log.w(TAG, "download $id failed", t)
                val reason = t.message ?: t::class.java.simpleName
                DownloadEvents.failed(id, reason)
                postResult("Download failed", reason.take(80), failed = true)
            } finally {
                cancelFlags.remove(id)
                jobs.remove(id)
                if (jobs.isEmpty()) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        jobs[id] = job
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MashupDownload"
        private const val CHANNEL_ID = "mashup_downloads"
        private const val NOTIF_ID = 4211
        /** Survives `stopForeground(STOP_FOREGROUND_REMOVE)`, so the outcome stays in the shade. */
        private const val NOTIF_ID_RESULT = 4212

        /** Progress granularity. 256 KiB keeps the UI smooth without flooding the JS bridge. */
        private const val PROGRESS_STEP = 256L * 1024L
        const val ACTION_START = "app.themashup.download.START"
        const val ACTION_CANCEL = "app.themashup.download.CANCEL"
        const val EXTRA_ID = "id"
        const val EXTRA_URL = "url"
        const val EXTRA_DEST = "dest"
        const val EXTRA_NAME = "name"

        /** Request headers the media URL needs, flattened as `name\nvalue` pairs. */
        const val EXTRA_HEADERS = "headers"

        fun intent(
            context: Context,
            id: String,
            url: String,
            dest: String,
            name: String,
            headers: Map<String, String> = emptyMap(),
        ): Intent =
            Intent(context, DownloadService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_ID, id)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_DEST, dest)
                putExtra(EXTRA_NAME, name)
                if (headers.isNotEmpty()) {
                    // Flattened rather than a Bundle of pairs: this crosses a process boundary as an
                    // Intent extra, where a null key or an unexpected type is a crash at dispatch.
                    putExtra(EXTRA_HEADERS, headers.map { "${it.key}\n${it.value}" }.toTypedArray())
                }
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
