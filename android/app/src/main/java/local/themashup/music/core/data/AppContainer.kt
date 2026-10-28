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
class AppContainer(context: Context) {

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

    /** Hydrate persistent state (call from Application.onCreate). */
    fun start() {
        library.startLoad()
        downloads.startLoad()
    }
}
