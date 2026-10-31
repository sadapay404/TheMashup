package local.themashup.music.core.data

import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.domain.DownloadStatus
import local.themashup.music.core.domain.DownloadsData
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.validateDownloadQuality

/**
 * Download queue state (queued → downloading → processing → completed/failed)
 * with JSON persistence for resume — parity with the gateway's
 * `data/downloads.json`. The actual queue executor (Media3/OkHttp + ffmpeg
 * first-run download) is Phase N7; this repository is its state contract.
 */
class DownloadsRepository(
    private val store: JsonFileStore<DownloadsData>,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val _state = MutableStateFlow(DownloadsData())
    val state: StateFlow<DownloadsData> = _state.asStateFlow()
    private val stateMutex = Mutex()
    private val loaded = CompletableDeferred<Unit>()

    fun startLoad() {
        scope.launch { load() }
    }

    suspend fun load() {
        try {
            stateMutex.withLock { _state.value = store.read() }
            loaded.complete(Unit)
        } catch (e: Exception) {
            loaded.completeExceptionally(e)
            throw e
        }
    }

    /** Playback can start during app startup; don't mistake an unhydrated list for no downloads. */
    suspend fun awaitLoaded() = loaded.await()

    /**
     * Validate + create a job — throws [IllegalArgumentException] with the
     * same message contract as the gateway's 400 VALIDATION_ERROR
     * (e.g. `quality 'mp3_320' invalid for mp3 (allowed: 128k, 320k)`).
     */
    suspend fun enqueue(track: Track, quality: String, container: String): DownloadJob {
        validateDownloadQuality(container, quality)?.let { throw IllegalArgumentException(it) }
        val now = System.currentTimeMillis()
        val job = DownloadJob(
            id = UUID.randomUUID().toString(),
            videoId = track.externalId,
            title = track.title,
            container = container,
            quality = quality,
            status = DownloadStatus.QUEUED,
            createdAt = now,
            updatedAt = now,
            track = track.copy(localDownloadId = null),
        )
        stateMutex.withLock { _state.value = store.update { it.copy(jobs = it.jobs + job) } }
        return job
    }

    suspend fun updateStatus(jobId: String, status: DownloadStatus, error: String? = null) =
        mutateJob(jobId) { job ->
            job.copy(status = status, error = error, updatedAt = System.currentTimeMillis())
        }

    suspend fun updateProgress(
        jobId: String,
        percent: Int,
        speedBps: Long? = null,
        etaSec: Long? = null,
    ) = mutateJob(jobId) { job ->
        job.copy(
            progress = percent.coerceIn(0, 100),
            speedBps = speedBps,
            etaSec = etaSec,
            status = if (percent in 1..99 && job.status == DownloadStatus.QUEUED) {
                DownloadStatus.DOWNLOADING
            } else {
                job.status
            },
            updatedAt = System.currentTimeMillis(),
        )
    }

    /** Downgrade note (e.g. remux skipped) kept alongside a job. */
    suspend fun setWarning(jobId: String, warning: String?) = mutateJob(jobId) { job ->
        job.copy(warning = warning, updatedAt = System.currentTimeMillis())
    }

    suspend fun markCompleted(
        jobId: String,
        filename: String,
        filesize: Long,
        location: String? = null,
        warning: String? = null,
    ) = mutateJob(jobId) { job ->
        job.copy(
            status = DownloadStatus.COMPLETED,
            filename = filename,
            filesize = filesize,
            location = location,
            warning = warning,
            progress = 100,
            speedBps = null,
            etaSec = null,
            error = null,
            updatedAt = System.currentTimeMillis(),
        )
    }

    /** Persist a recovered legacy URI only if the same completed job still exists. */
    suspend fun rememberLocation(jobId: String, location: String) = mutateJob(jobId) { job ->
        if (job.status == DownloadStatus.COMPLETED) job.copy(location = location) else job
    }

    suspend fun remove(jobId: String) {
        stateMutex.withLock { _state.value = store.update { it.copy(jobs = it.jobs.filterNot { j -> j.id == jobId }) } }
    }

    fun job(jobId: String): DownloadJob? = _state.value.jobs.firstOrNull { it.id == jobId }

    /** In-flight rows (restart reconciliation + progress sections). */
    fun activeJobs(): List<DownloadJob> =
        _state.value.jobs.filter {
            it.status == DownloadStatus.QUEUED ||
                it.status == DownloadStatus.DOWNLOADING ||
                it.status == DownloadStatus.PROCESSING
        }

    private suspend fun mutateJob(jobId: String, fn: (DownloadJob) -> DownloadJob) {
        stateMutex.withLock {
            _state.value = store.update { data ->
                data.copy(jobs = data.jobs.map { if (it.id == jobId) fn(it) else it })
            }
        }
    }

}
