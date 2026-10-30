package local.themashup.music.core.data

import android.content.Context
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import local.themashup.music.core.domain.DownloadsData
import local.themashup.music.core.domain.LibraryData

/**
 * Composition root — constructed once in [local.themashup.music.TheMashupApp],
 * handed down via composition locals (N3). Pure JVM repositories are built
 * against [JsonFileStore]; Android-only pieces (DataStore, downloads executor,
 * playback service) are layered on top as phases land.
 */
class AppContainer(private val context: Context) {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val library: LibraryRepository = LibraryRepository(
        JsonFileStore(File(context.filesDir, "library.json"), LibraryData.serializer()) { LibraryData() },
        appScope,
    )

    val downloads: DownloadsRepository = DownloadsRepository(
        JsonFileStore(File(context.filesDir, "downloads.json"), DownloadsData.serializer()) { DownloadsData() },
        appScope,
    )

    val settings = SettingsRepository(context)

    /** N3 extraction facade (NewPipe primary + Piped/Invidious + LRCLIB). */
    val extraction: local.themashup.music.core.network.ExtractionService by lazy {
        local.themashup.music.core.network.ExtractionService()
    }

    /** N4 player: pure state machine + ExoPlayer shell (service attaches player). */
    val player: local.themashup.music.core.player.PlaybackEngine by lazy {
        local.themashup.music.core.player.PlaybackEngine(context, extraction = { extraction })
    }

    /** N9: ffmpeg is bundled in the APK (jniLibs → nativeLibraryDir). */
    val ffmpeg: local.themashup.music.core.download.FfmpegManager by lazy {
        local.themashup.music.core.download.FfmpegManager(
            File(context.applicationInfo.nativeLibraryDir),
        )
    }

    /** N7 download runner: streams → ffmpeg Process → MediaStore.Downloads. */
    val downloadEngine: local.themashup.music.core.download.DownloadEngine by lazy {
        local.themashup.music.core.download.DownloadEngine(
            repository = downloads,
            extraction = extraction,
            ffmpeg = ffmpeg,
            client = local.themashup.music.core.network.newNetworkClient(),
            context = context,
            workDir = File(context.cacheDir, "downloads"),
        )
    }

    /** Hydrate persistent state (call from Application.onCreate). */
    fun start() {
        library.startLoad()
        downloads.startLoad()
        downloadEngine.reconcileOnStart()
    }
}
