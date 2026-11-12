package app.themashup.music.extractor.generated

import app.themashup.music.extractor.StreamExtractor
import app.themashup.music.playback.poToken.PoTokenGenerator
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.schabi.newpipe.extractor.services.youtube.extractors.YoutubeStreamExtractor
import org.schabi.newpipe.extractor.stream.StreamInfo

/**
 * Native YouTube stream resolver backed by NewPipe Extractor with a real PoToken provider.
 *
 * This is the only GPL-touching class in the app. It lives exclusively in the
 * `withNativeExtractor` source set so the default `standard` flavour compiles without any GPL code.
 *
 * How it works:
 *  1. [initialize(Context)] is called from [MainActivity] at app start. It stores the Context and
 *     installs a WebView-based BotGuard PoToken generator (ported from LibreTube) via
 *     [YoutubeStreamExtractor.setPoTokenProvider]. This is what lets NewPipeExtractor obtain
 *     signed `pot=` parameters for age-restricted / throttled streams.
 *  2. [resolve] fetches the stream manifest via [StreamInfo.getInfo] and returns the first
 *     playable audio-stream URL to the JS layer, which hands it to ExoPlayer via
 *     [PlaybackBridge.play].
 *  3. Falls back to HLS / DASH manifests if no direct audio URL is available.
 *
 * Without step 1, most YouTube audio streams are throttled to ~1-2 MB and then cut — the exact
 * failure this app has been debugging for months.
 *
 * Licence: GPL-3.0 (NewPipe Extractor + PoToken generator port). The `standard` flavour never
 * references this class, so the default APK stays licence-clean.
 */
class NativeExtractorImpl : StreamExtractor {

    companion object {
        @Volatile
        private var appContext: Context? = null

        @Volatile
        private var poTokenInstalled = false

        /**
         * Call once from [MainActivity] after the delegate is installed. Provides the Context
         * needed to create the hidden WebView for BotGuard PoToken generation, and installs the
         * PoToken provider with NewPipeExtractor.
         *
         * @JvmStatic so [MainActivity] can reach it via reflection
         * (Class.forName(...).getMethod("initialize", Context::class.java)).
         */
        @JvmStatic
        fun initialize(context: Context) {
            appContext = context
            installPoTokenProviderLocked()
        }

        private fun installPoTokenProviderLocked() {
            if (poTokenInstalled) return
            val ctx = appContext
                ?: error("NativeExtractorImpl.initialize(Context) requires a non-null Context")
            val generator = PoTokenGenerator()
            generator.setAppContext(ctx)
            YoutubeStreamExtractor.setPoTokenProvider(generator)
            poTokenInstalled = true
        }
    }

    override suspend fun resolve(videoId: String): String? = withContext(Dispatchers.IO) {
        companion.installPoTokenProviderLocked()

        val info = StreamInfo.getInfo("https://www.youtube.com/watch?v=$videoId")

        // Pick an audio stream. Prefer one with a direct URL; fall back to HLS/DASH if present.
        info.audioStreams.firstOrNull { it.url.isNotBlank() }?.url
            ?: info.hlsUrl
            ?: info.dashMpdUrl
            ?: null
    }
}
