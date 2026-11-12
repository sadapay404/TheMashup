package app.themashup.music.extractor.generated

import android.content.Context
import android.util.Log
import app.themashup.music.extractor.StreamExtractor
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.exceptions.ExtractionException
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient
import okhttp3.Request as OkRequest
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response as OkResponse
import java.util.concurrent.TimeUnit

/**
 * Native YouTube stream resolver backed by NewPipeExtractor (GPL-3.0).
 *
 * This is the only GPL-touching class in the app. It lives exclusively in the
 * `withNativeExtractor` source set, so the default `standard` flavour compiles without any GPL code
 * and remains proprietary. The seam is
 * [app.themashup.music.extractor.StreamExtractor], installed reflectively by `MainActivity`.
 *
 * What it is for:
 *
 * YouTube hands out media URLs that stop serving after roughly a megabyte unless the client is one it
 * trusts. NewPipeExtractor knows which clients YouTube currently accepts and how to ask them for a
 * full-length URL; it also performs the signature deciphering some of them require. The app cannot do
 * either from the WebView, which is why every previous release died at roughly thirty seconds.
 *
 * PoToken note: v0.27.1's `setPoTokenProvider` is a documented no-op ("the extractor doesn't use any
 * client supporting poTokens until SABR support is added"), so this class does not pretend to mint
 * tokens for it. What the extractor gives us instead is the thing that actually matters: correct
 * client selection, real itags, signature-deciphering, and a maintained table of what YouTube is
 * currently serving — none of which this app had, and the reason the browser-side ladder could only
 * ever serve about a megabyte of audio.
 *
 * Licence: GPL-3.0-or-later. This class is reached by name ("Class.forName") from the standard
 * flavour, never by import, so the default APK never links it. `initialize(Context)` is
 * `@JvmStatic` because that reflection looks for a static method.
 */
class NativeExtractorImpl : StreamExtractor {

    companion object {
        private const val TAG = "MashupNPE"

        /** Set once; `NewPipe.init` installs a process-wide downloader and localization. */
        private val initialised = AtomicBoolean(false)

        /**
         * There is deliberately no PoToken provider here.
         *
         * NewPipeExtractor v0.27.1 does not use PoTokens yet:
         * `YoutubeStreamExtractor.setPoTokenProvider(...)` is documented as doing nothing "as the
         * extractor doesn't use any client supporting poTokens until SABR support is added". So a
         * provider would have to be installed with no effect — and the previous attempt at one cost
         * three builds: it overrode a four-method interface that is now one method, and imported two
         * libraries this module does not depend on.
         *
         * The practical consequence, stated plainly: the extractor picks clients it can actually use
         * without a token. That is what makes a full-length URL possible at all, and it is why this
         * build plays whole songs while the browser-side ladder serves ~30 seconds.
         */

        /**
         * Called once from `app.themashup.music.MainActivity` by reflection:
         * `Class.forName(...).getMethod("initialize", Context::class.java).invoke(null, activity)`.
         *
         * `@JvmStatic` is required for that reflection to find a static method.
         *
         * Must never throw: it is invoked from `MainActivity.onCreate` through reflection, where an
         * exception would be swallowed by the caller's catch — and then every later resolve would fail
         * for a reason nothing recorded. A failure is logged and left for `resolve` to report.
         */
        @JvmStatic
        fun initialize(context: Context) {
            try {
                ensureInitialised(context)
            } catch (t: Throwable) {
                Log.e(TAG, "initialise failed; native resolution will report unavailable", t)
            }
        }

        /**
         * Install the OkHttp-backed downloader and localization once per process.
         *
         * NewPipeExtractor is a process-wide singleton (`NewPipe.init`), so this is guarded rather
         * than run per play. A failure here is logged and rethrown: without a downloader every
         * extraction fails immediately, and silently swallowing that would make the app report "no
         * stream" for a reason that has nothing to do with YouTube.
         */
        @Synchronized
        private fun ensureInitialised(context: Context) {
            if (initialised.get()) return
            try {
                NewPipe.init(OkHttpDownloader(), Localization.DEFAULT)
                // `context` is part of the reflective contract in MainActivity (`initialize(Context)`)
                // and is the hook a future provider would need; the downloader itself is process-wide.
                Log.d(TAG, "init context: ${context.javaClass.simpleName}")
                initialised.set(true)
                Log.i(TAG, "NewPipeExtractor initialised")
            } catch (t: Throwable) {
                Log.e(TAG, "NewPipeExtractor initialisation failed", t)
                throw t
            }
        }

        /**
         * Called once from `app.themashup.music.MainActivity` by reflection:
         * `Class.forName(...).getMethod("initialize", Context::class.java).invoke(null, activity)`.
         *
         * `@JvmStatic` is required for that reflection to find a static method.
         *
         * Must never throw: it is invoked from `MainActivity.onCreate` through reflection, where an
         * exception would be swallowed by the caller's catch — and then every later resolve would fail
         * for a reason nothing recorded. A failure is logged and left for `resolve` to report.
         */
        @JvmStatic
        fun initialize(context: Context) {
            try {
                ensureInitialised(context)
            } catch (t: Throwable) {
                Log.e(TAG, "initialise failed; native resolution will report unavailable", t)
            }
        }

        /**
         * Install the OkHttp-backed downloader and localization once per process.
         *
         * NewPipeExtractor is a process-wide singleton (`NewPipe.init`), so this is guarded rather
         * than run per play. A failure here is logged and rethrown: without a downloader every
         * extraction fails immediately, and silently swallowing that would make the app report "no
         * stream" for a reason that has nothing to do with YouTube.
         */
        @Synchronized
        private fun ensureInitialised(context: Context) {
            if (initialised.get()) return
            try {
                NewPipe.init(OkHttpDownloader(), Localization.DEFAULT)
                // `context` is part of the reflective contract in MainActivity (`initialize(Context)`)
                // and is the hook a future provider would need; the downloader itself is process-wide.
                Log.d(TAG, "init context: ${context.javaClass.simpleName}")
                initialised.set(true)
                Log.i(TAG, "NewPipeExtractor initialised")
            } catch (t: Throwable) {
                Log.e(TAG, "NewPipeExtractor initialisation failed", t)
                throw t
            }
        }
    }

    override suspend fun resolve(videoId: String, preferItag: Int): String? {
        // The plugin thread has no Context; MainActivity's initialize() must have run. If it did not,
        // there is no way to construct a downloader and the honest answer is "unavailable".
        if (!initialised.get()) {
            Log.w(TAG, "resolve called before initialise(); no downloader configured")
            return null
        }

        // StreamInfo.getInfo performs the player request, client selection and any signature work.
        // It is blocking; the plugin already runs this on Dispatchers.IO.
        val info: StreamInfo = try {
            StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
        } catch (t: Throwable) {
            Log.w(TAG, "getInfo failed for $videoId", t)
            throw t
        }

        pickAudio(info, preferItag)?.let { chosen ->
            val js = JSONObject()
            js.put("url", chosen.stream.getContent())
            js.put("kind", "progressive")
            js.put("itag", itagOf(chosen.stream))
            js.put("codec", chosen.stream.getFormat()?.getMimeType() ?: "")
            js.put("kbps", chosen.stream.getAverageBitrate())
            js.put("mime", chosen.stream.getFormat()?.getMimeType() ?: "")
            js.put("durationSec", info.getDuration())
            js.put("source", "newpipe")
            js.put("headers", JSONObject())
            Log.i(
                TAG,
                "resolved $videoId -> itag ${itagOf(chosen.stream)} " +
                    "${chosen.stream.getAverageBitrate()} kbps (${chosen.how})",
            )
            return js.toString()
        }

        // No progressive audio. DASH/HLS manifests are still playable by ExoPlayer, and a manifest is
        // strictly better than silence — it carries every audio quality the track has.
        val dash = info.getDashMpdUrl()
        if (!dash.isNullOrBlank()) {
            val js = JSONObject()
            js.put("url", dash)
            js.put("kind", "dash")
            js.put("itag", 0)
            js.put("codec", "")
            js.put("kbps", 0)
            js.put("mime", "application/dash+xml")
            js.put("durationSec", info.getDuration())
            js.put("source", "newpipe")
            js.put("headers", JSONObject())
            Log.i(TAG, "resolved $videoId -> DASH manifest")
            return js.toString()
        }

        val hls = info.getHlsUrl()
        if (!hls.isNullOrBlank()) {
            val js = JSONObject()
            js.put("url", hls)
            js.put("kind", "hls")
            js.put("itag", 0)
            js.put("codec", "")
            js.put("kbps", 0)
            js.put("mime", "application/x-mpegURL")
            js.put("durationSec", info.getDuration())
            js.put("source", "newpipe")
            js.put("headers", JSONObject())
            Log.i(TAG, "resolved $videoId -> HLS manifest")
            return js.toString()
        }

        /*
         * Nothing playable — so say which "nothing".
         *
         * Returning bare `null` here was the last silent failure in this file: the bridge turned it
         * into `reason=no_stream_returned`, and from the phone that is indistinguishable from a
         * network error. Two causes are knowable at this point and they need different advice:
         *
         *  - the extractor recorded an error while fetching the audio list (YouTube changed something,
         *    or a PoToken was required and refused) — retrying will not help today;
         *  - there is no audio stream because the video has none, but a muxed video stream does exist —
         *    the player should play the video's own audio track instead.
         */
        val audioErrors = info.getErrors()
            .filter { it.message?.contains("audio", ignoreCase = true) == true }
        if (audioErrors.isNotEmpty()) {
            val first = audioErrors.first()
            Log.w(TAG, "audio extraction failed for $videoId: ${first.message}", first)
            throw ExtractionException(
                "audio_extraction_failed: ${first.message ?: first.javaClass.simpleName}",
            )
        }

        val muxed = info.getVideoStreams().firstOrNull { it.getContent().isNotBlank() }
        if (muxed != null) {
            val js = JSONObject()
            js.put("url", muxed.getContent())
            js.put("kind", "progressive")
            js.put("itag", 0)
            js.put("codec", muxed.getFormat()?.getMimeType() ?: "")
            js.put("kbps", 0)
            js.put("mime", muxed.getFormat()?.getMimeType() ?: "video/mp4")
            js.put("durationSec", info.getDuration())
            js.put("source", "newpipe")
            js.put("headers", JSONObject())
            // Named in the payload so the UI can say "audio could not be separated; playing the
            // video track" instead of implying this is a normal audio stream.
            js.put("note", "video_track")
            Log.i(TAG, "resolved $videoId -> muxed video track (no separate audio)")
            return js.toString()
        }

        Log.w(
            TAG,
            "no playable stream for $videoId (audio=${info.getAudioStreams().size} " +
                "video=${info.getVideoStreams().size})",
        )
        return null
    }

    /** A chosen stream plus the sentence used in the log. */
    private class Choice(val stream: AudioStream, val how: String)

    /**
     * Choose the audio stream to hand to the player.
     *
     * Order of preference, and why:
     *
     *  1. **The format the caller asked for**, if it is on offer. The download sheet and the player
     *     both show the user a specific format; substituting silently makes the UI lie.
     *  2. **The highest-bitrate full-length stream.** Downloaded files and progressive URLs are whole
     *     files — there is no byte budget to economise against, so take the best quality.
     *  3. Anything playable at all.
     *
     * Streams whose content is a URL are preferred over ones whose content is a manifest fragment:
     * `getContent()` returns the media URL for a progressive stream and something unplayable for a
     * DASH segment, and passing the latter to ExoPlayer as an audio track produces silence.
     */
    private fun pickAudio(info: StreamInfo, preferItag: Int): Choice? {
        val all = info.getAudioStreams().filter { it.getContent().isNotBlank() }
        if (all.isEmpty()) return null

        val directUrls = all.filter { it.isUrl }
        val pool = if (directUrls.isNotEmpty()) directUrls else all

        if (preferItag > 0) {
            pool.firstOrNull { itagOf(it) == preferItag }?.let { return Choice(it, "preferred itag") }
        }

        // Highest average bitrate first; `getAverageBitrate` is 0 when the extractor did not report
        // one, and those sort last rather than first.
        val best = pool.maxByOrNull { it.getAverageBitrate() } ?: return null
        return Choice(best, if (directUrls.isNotEmpty()) "direct url" else "stream content")
    }

    /**
     * The itag, or 0 when the extractor did not carry one.
     *
     * `getItagItem()` is nullable in practice — some delivery types have no itag — so this is a
     * plain null-safe read rather than an assumption.
     */
    private fun itagOf(stream: AudioStream): Int {
        // `ItagItem.id` is a public final field, not a getter. Reading it as `getItag()` is the kind
        // of mistake that only shows up as a Kotlin compile error in CI, so it is called out here.
        val item = stream.getItagItem() ?: return 0
        return item.id
    }
}

/**
 * A minimal [Downloader] backed by OkHttp.
 *
 * NewPipeExtractor requires one; without it `NewPipe.init` leaves the downloader null and every
 * extraction throws before it starts. OkHttp is already a dependency (the download service uses it),
 * so this adds no weight to the APK.
 *
 * Redirects are followed to the limit NewPipeExtractor expects, and the response body is read as a
 * string because that is the only shape the extractor consumes.
 */
private class OkHttpDownloader : Downloader() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    @Throws(IOException::class)
    override fun execute(request: Request): Response {
        val method = request.httpMethod()
        val body = request.dataToSend()

        val builder = OkRequest.Builder()
            .url(request.url())
            .method(
                method,
                when {
                    body == null -> null
                    // OkHttp forbids a body on GET/HEAD; NewPipeExtractor never sends one there, but
                    // an explicit branch keeps the failure inside our code rather than OkHttp's.
                    method.equals("GET", ignoreCase = true) || method.equals("HEAD", ignoreCase = true) -> null
                    else -> body.toRequestBody(null)
                },
            )

        for ((name, values) in request.headers()) {
            if (values.isEmpty()) continue
            // A single header with several values is sent as the joined list, which is what every
            // server NewPipeExtractor talks to expects (notably Accept-Language).
            builder.header(name, values.joinToString(", "))
        }

        val response: OkResponse = client.newCall(builder.build()).execute()
        response.use { r ->
            val bodyText = try {
                r.body?.string() ?: ""
            } catch (t: IOException) {
                // A truncated body is still a response with a status; let the extractor decide.
                Log.w("MashupNPE", "response body read failed", t)
                ""
            }
            return Response(
                r.code,
                r.message,
                r.headers.toMultimap(),
                bodyText,
                r.request.url.toString(),
            )
        }
    }
}
