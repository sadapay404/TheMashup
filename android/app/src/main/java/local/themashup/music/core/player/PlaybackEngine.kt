package local.themashup.music.core.player

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.TextureView
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import local.themashup.music.core.domain.RepeatMode
import local.themashup.music.core.domain.StreamCandidate
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.network.logic.StreamNormalize

/**
 * Executes [PlaybackStateMachine] effects against ExoPlayer and feeds player
 * callbacks back into the pure machine. Same-process shell: the UI observes
 * [state], the [TheMashupPlayerService] attaches the ExoPlayer instance that
 * backs the media notification / lock-screen controls.
 *
 * Threading: every transition runs on Dispatchers.Main (player thread);
 * network resolution hops to Dispatchers.IO.
 */
class PlaybackEngine(
    private val appContext: Context,
    private val extraction: () -> ExtractionService,
    private val downloads: DownloadedPlayback,
    private val onPlaybackStarted: suspend (local.themashup.music.core.domain.Track, String?) -> Unit = { _, _ -> },
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) {
    private val _state = MutableStateFlow(PlayerSnapshot())
    val state: StateFlow<PlayerSnapshot> = _state.asStateFlow()

    private var player: ExoPlayer? = null
    private var serviceStarted = false
    private var resolveGeneration = 0L
    private var recordedGeneration = -1L
    private var videoView: TextureView? = null
    private var visualizerActive = false
    private val failedPositions = mutableSetOf<Int>()

    /** Web parity: `Math.random()`-style rng for shuffle picks. */
    private var rng: () -> Double = { Random.nextDouble() }

    private val sm: PlaybackStateMachine get() = PlaybackStateMachine

    /* ── lifecycle: service attaches/detaches the player ──────────────────── */

    fun attachPlayer(p: ExoPlayer) {
        player = p
        p.addListener(playerListener)
        applyPlayerMirrors(_state.value)
        videoView?.let { p.setVideoTextureView(it) }
        // Resolution can finish before the service attaches its player.
        val snapshot = _state.value
        if (snapshot.status == PlayStatus.LOADING) {
            snapshot.failover?.active?.let { loadCandidate(PlayerEffect.LoadCandidate(it, snapshot.positionMs)) }
        }
        if (visualizerActive) updateVisualizerBinding()
    }

    /** The same service player renders an explicitly selected downloaded video. */
    fun attachVideoView(view: TextureView) {
        if (videoView === view) return
        videoView?.let { player?.clearVideoTextureView(it) }
        videoView = view
        player?.setVideoTextureView(view)
    }

    fun detachVideoView(view: TextureView) {
        if (videoView !== view) return
        player?.clearVideoTextureView(view)
        videoView = null
    }

    fun detachPlayer(p: Player) {
        p.removeListener(playerListener)
        if (player === p) {
            player = null
            serviceStarted = false
            ++resolveGeneration
            // A paused/background service may be destroyed while the app
            // process survives. Make Play re-create and re-resolve it rather
            // than forwarding to a player that no longer exists.
            _state.update { snapshot ->
                if (snapshot.status == PlayStatus.PLAYING || snapshot.status == PlayStatus.PAUSED || snapshot.status == PlayStatus.LOADING) {
                    snapshot.copy(status = PlayStatus.IDLE, failover = null, source = null)
                } else snapshot
            }
            updateVisualizerBinding()
        }
    }

    /* ── N8 visualizer: FFT feed for the expanded-player bar strip ──────── */

    /** Owns the `android.media.audiofx.Visualizer` (service attaches player). */
    val visualizer = OutputVisualizer()

    private var vizPoller: kotlinx.coroutines.Job? = null
    private var vizControl: kotlinx.coroutines.Job? = null
    private val visualizerLock = Any()
    @Volatile private var vizRevision = 0L

    /**
     * The audio session id is unset until ExoPlayer finishes initializing the
     * output, so poll cheaply until bound; permission refusals back off to a
     * slow tick (cleared via [OutputVisualizer.allowRetry] after the grant).
     */
    private fun startVisualizerPoller(p: ExoPlayer) {
        vizPoller?.cancel()
        val revision = vizRevision
        vizPoller = scope.launch {
            while (isActive && revision == vizRevision) {
                // ExoPlayer is owned by the main looper; read its session ID here,
                // then do the potentially slow AudioEffect binding off the UI thread.
                val sessionId = OutputVisualizer.audioSessionIdOf(p)
                when (withContext(Dispatchers.IO) {
                    synchronized(visualizerLock) {
                        if (revision == vizRevision) visualizer.tryBind(sessionId)
                        else OutputVisualizer.BindOutcome.RETRY
                    }
                }) {
                    OutputVisualizer.BindOutcome.BOUND -> break
                    OutputVisualizer.BindOutcome.RETRY -> delay(1_000)
                    OutputVisualizer.BindOutcome.UNAVAILABLE -> delay(10_000)
                }
            }
        }
    }

    /** Capture only while the visible, enabled visualizer needs it. */
    fun setVisualizerActive(active: Boolean) {
        if (visualizerActive == active) return
        visualizerActive = active
        updateVisualizerBinding()
    }

    private fun updateVisualizerBinding() {
        val revision = ++vizRevision
        vizPoller?.cancel()
        vizPoller = null
        vizControl?.cancel()
        vizControl = scope.launch {
            // Visualizer release/binding can block in platform audio services.
            withContext(Dispatchers.IO) { synchronized(visualizerLock) { visualizer.release() } }
            if (revision == vizRevision && visualizerActive) player?.let(::startVisualizerPoller)
        }
    }

    fun retryVisualizer() {
        val revision = vizRevision
        scope.launch {
            withContext(Dispatchers.IO) {
                synchronized(visualizerLock) {
                    if (revision == vizRevision) visualizer.allowRetry()
                }
            }
            if (revision == vizRevision && visualizerActive) player?.let(::startVisualizerPoller)
        }
    }

    /* ── UI / session commands ───────────────────────────────────────────── */

    fun playQueue(
        tracks: List<local.themashup.music.core.domain.Track>,
        startIndex: Int = 0,
        startAtMs: Long = 0,
        context: String? = null,
    ) {
        failedPositions.clear()
        ensureServiceStarted()
        dispatch { sm.playQueue(it, tracks, startIndex, startAtMs, context) }
    }

    fun playNow(track: local.themashup.music.core.domain.Track, context: String? = null) {
        failedPositions.clear()
        ensureServiceStarted()
        dispatch { sm.playNow(it, track, context) }
    }

    fun togglePlay() {
        if (_state.value.status == PlayStatus.ERROR || _state.value.status == PlayStatus.IDLE) failedPositions.clear()
        dispatch(sm::toggle)
    }
    fun nextTrack() {
        failedPositions.clear()
        dispatch { sm.next(it, rng, manual = true) }
    }
    fun prevTrack() {
        failedPositions.clear()
        // Android convention: >3s into a track restarts it, else step back.
        if (_state.value.positionMs > 3_000 && _state.value.cursor >= 0) {
            dispatch { sm.seek(it, 0) }
        } else {
            dispatch { sm.prev(it, rng) }
        }
    }

    fun seekTo(positionMs: Long) = dispatch { sm.seek(it, positionMs) }
    fun setRepeat(mode: RepeatMode) = dispatchSimple { sm.setRepeat(it, mode) }
    fun cycleRepeat() = dispatchSimple { sm.cycleRepeat(it) }
    fun setShuffle(on: Boolean) = dispatchSimple { sm.setShuffle(it, on) }
    fun toggleShuffle() = dispatchSimple { sm.setShuffle(it, !it.shuffle) }

    fun addNext(track: local.themashup.music.core.domain.Track) =
        dispatchSimple { sm.enqueue(it, track, local.themashup.music.core.domain.InsertMode.NEXT) }

    fun addToEnd(track: local.themashup.music.core.domain.Track) =
        dispatchSimple { sm.enqueue(it, track, local.themashup.music.core.domain.InsertMode.END) }

    fun removeFromQueue(index: Int) {
        failedPositions.clear()
        dispatch { sm.remove(it, index) }
    }
    fun moveInQueue(from: Int, to: Int) {
        failedPositions.clear()
        dispatchSimple { sm.move(it, from, to) }
    }
    fun clearQueue() {
        failedPositions.clear()
        dispatch(sm::clear)
    }

    /** Tests/preview: deterministic shuffle sequence. */
    fun setRngForTesting(seedRng: () -> Double) {
        rng = seedRng
    }

    /* ── transition executor ─────────────────────────────────────────────── */

    /** Machine methods without effects return a bare snapshot — pair them with null. */
    private fun dispatchSimple(fn: (PlayerSnapshot) -> PlayerSnapshot) =
        dispatch { fn(it) to null }

    private fun dispatch(fn: (PlayerSnapshot) -> Pair<PlayerSnapshot, PlayerEffect?>) {
        scope.launch {
            val current = _state.value
            val (next, effect) = fn(current)
            _state.value = next
            applyPlayerMirrors(next)
            if (effect != null) execute(effect)
        }
    }

    private fun execute(effect: PlayerEffect) {
        when (effect) {
            is PlayerEffect.Resolve -> {
                if (!ensureServiceStarted()) {
                    parkError("Could not start the playback service. Open the app and try again.")
                    return
                }
                if (!effect.isRefresh) {
                    // Keep the paused timeline visible to Media3 while the next
                    // item resolves; clearing it would remove the notification.
                    // Listener callbacks below reject events from this old item.
                    player?.pause()
                }
                resolveAndLoad(effect)
            }
            is PlayerEffect.LoadCandidate -> loadCandidate(effect)
            PlayerEffect.Play -> player?.play()
            PlayerEffect.Pause -> player?.pause()
            is PlayerEffect.Seek -> {
                // Ignore seeks with no loaded media (e.g. cleared queue).
                if (player?.mediaItemCount != 0) player?.seekTo(effect.positionMs)
            }
            PlayerEffect.Stop -> {
                ++resolveGeneration
                player?.stop()
                player?.clearMediaItems()
            }
            is PlayerEffect.Fail -> {
                ++resolveGeneration
                // Snapshot already carries the error; stop any stale audio.
                player?.stop()
                player?.clearMediaItems()
            }
        }
    }

    /**
     * N9 product rule: an unplayable track must not wedge the queue (FOSS
     * parity — RiMusic/InnerTune-style auto-skip). Advances when a forward
     * move exists (shuffle: any other index); otherwise parks in ERROR so the
     * toast shows and tap-to-retry still works. Guards: no wrap at the end,
     * no repeat-ONE loop on a dead track.
     */
    private fun advanceOrPark(message: String) {
        val snapshot = _state.value
        if (snapshot.cursor >= 0) failedPositions += snapshot.cursor
        val target = FailureSkipPolicy.nextIndex(snapshot, failedPositions, rng)
        if (target != null) {
            val (advanced, effect) = sm.playQueue(snapshot, snapshot.queue, target, context = snapshot.contextLabel)
            _state.value = advanced
            applyPlayerMirrors(advanced)
            effect?.let { execute(it) }
        } else {
            parkError(message)
        }
    }

    private fun resolveAndLoad(effect: PlayerEffect.Resolve) {
        val track = effect.track
        val generation = ++resolveGeneration
        scope.launch {
            val outcome = try {
                withContext(Dispatchers.IO) {
                    // A failed local copy selected from search/home may fall back
                    // to streaming. An explicitly selected download never does.
                    val skipLocal = effect.isRefresh && track.localDownloadId == null &&
                        _state.value.failover?.active?.source == DownloadedPlayback.SOURCE
                    val local = if (skipLocal) DownloadLookup.NotDownloaded else downloads.find(track)
                    when (local) {
                        is DownloadLookup.Found -> ResolvedMedia(listOf(local.candidate), emptyList())
                        DownloadLookup.Missing -> throw MissingDownloadException()
                        DownloadLookup.NotDownloaded -> {
                            val streams = extraction().streams(track.externalId)
                            ResolvedMedia(streams.candidates.filter { !it.videoOnly }, streams.warnings)
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation != resolveGeneration || _state.value.current?.id != track.id) return@launch
                if (e is MissingDownloadException) {
                    parkError(DownloadedPlayback.MISSING_MESSAGE)
                } else {
                    advanceOrPark(e.message ?: "Extraction failed")
                }
                return@launch
            }
            if (generation != resolveGeneration || _state.value.current?.id != track.id) return@launch
            val (s, e) = sm.onCandidatesResolved(
                _state.value,
                outcome.candidates,
                startAtMs = effect.startAtMs,
                isRefresh = effect.isRefresh,
            )
            _state.value = s.copy(warnings = (s.warnings + outcome.warnings).distinct().take(10))
            if (s.status == PlayStatus.ERROR) advanceOrPark(s.error ?: "No playable streams")
            else e?.let { execute(it) }
        }
    }

    private data class ResolvedMedia(val candidates: List<StreamCandidate>, val warnings: List<String>)
    private class MissingDownloadException : Exception(DownloadedPlayback.MISSING_MESSAGE)

    private fun parkError(message: String) {
        val (parked, effect) = sm.onResolveFailed(_state.value, message, _state.value.warnings)
        _state.value = parked
        applyPlayerMirrors(parked)
        effect?.let { execute(it) }
    }

    private fun loadCandidate(effect: PlayerEffect.LoadCandidate) {
        val p = player ?: return
        // Stale guard: this candidate no longer belongs to the loaded track.
        if (_state.value.failover?.active?.id != effect.candidate.id) return
        p.setMediaSource(mediaSourceFor(effect.candidate))
        p.prepare()
        if (effect.startAtMs > 0) p.seekTo(effect.startAtMs)
        p.playWhenReady = true
    }

    private fun mediaSourceFor(c: StreamCandidate): MediaSource {
        val headers = c.httpHeaders.ifEmpty { StreamNormalize.YOUTUBE_HEADERS }
        val httpFactory = DefaultHttpDataSource.Factory().setDefaultRequestProperties(headers)
        // DefaultDataSource delegates content:// and file:// to local Android
        // data sources, while retaining the custom headers for HTTP streams.
        val dataFactory = DefaultDataSource.Factory(appContext, httpFactory)
        val track = _state.value.current
        val metadata = MediaMetadata.Builder()
            .setTitle(track?.title)
            .setArtist(track?.artistNames)
            .apply { (track?.artworkBest ?: track?.artwork)?.let { setArtworkUri(Uri.parse(it)) } }
            .build()
        val item = MediaItem.Builder()
            .setMediaId(c.id)
            .setUri(c.url)
            .setMediaMetadata(metadata)
            .build()
        return DefaultMediaSourceFactory(dataFactory).createMediaSource(item)
    }

    /** Repeat/shuffle display + single-item safety mirror (see class docs). */
    private fun applyPlayerMirrors(snapshot: PlayerSnapshot) {
        val p = player ?: return
        p.repeatMode = if (snapshot.repeat == RepeatMode.ONE) {
            Player.REPEAT_MODE_ONE
        } else {
            // ALL/OFF → OFF: with our single-item timeline, player-internal
            // looping would swallow completion events; the machine owns the
            // ALL wrap (onTrackCompleted → nextIndex).
            Player.REPEAT_MODE_OFF
        }
        p.shuffleModeEnabled = snapshot.shuffle
    }

    private fun ensureServiceStarted(): Boolean {
        if (serviceStarted) return true
        return try {
            appContext.startService(Intent(appContext, TheMashupPlayerService::class.java))
            serviceStarted = true
            true
        } catch (_: Exception) {
            // A later foreground action can retry instead of latching failure.
            false
        }
    }

    /* ── player → machine ────────────────────────────────────────────────── */

    private fun activeMediaMatches(snapshot: PlayerSnapshot): Boolean {
        val candidate = snapshot.failover?.active ?: return false
        return player?.currentMediaItem?.mediaId == candidate.id
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!activeMediaMatches(_state.value)) return
            _state.update { sm.onPlayingChanged(it, isPlaying) }
            val snapshot = _state.value
            val track = snapshot.current
            if (isPlaying && track != null && snapshot.failover != null && recordedGeneration != resolveGeneration) {
                failedPositions.clear()
                recordedGeneration = resolveGeneration
                // History should still work if the saved file is later removed.
                scope.launch(Dispatchers.IO) {
                    try {
                        onPlaybackStarted(track.copy(localDownloadId = null), snapshot.contextLabel)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        // A history write failure must not interrupt playback.
                    }
                }
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (!activeMediaMatches(_state.value)) return
            when (playbackState) {
                Player.STATE_BUFFERING -> _state.update { sm.onBuffering(it) }
                Player.STATE_ENDED -> {
                    val (next, effect) = sm.onTrackCompleted(_state.value, rng)
                    _state.value = next
                    applyPlayerMirrors(next)
                    effect?.let { execute(it) }
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            val snapshot = _state.value
            val candidate = snapshot.failover?.active ?: return
            if (!activeMediaMatches(snapshot)) return
            if (candidate.source == DownloadedPlayback.SOURCE && snapshot.current?.localDownloadId != null) {
                parkError(DownloadedPlayback.PLAYBACK_ERROR)
                return
            }
            val (next, effect) = sm.onCandidateFailed(snapshot)
            if (next.status == local.themashup.music.core.player.PlayStatus.ERROR) {
                // N9: never wedge the queue — auto-skip to the next track.
                advanceOrPark(next.error ?: error.message ?: "Playback failed")
                return
            }
            _state.value = next
            applyPlayerMirrors(next)
            effect?.let { execute(it) }
        }
    }

    /** Position ticker (Android has no timeupdate event on ExoPlayer). */
    init {
        scope.launch {
            while (isActive) {
                delay(500)
                val p = player ?: continue
                if ((p.isPlaying || p.playbackState == Player.STATE_READY) && activeMediaMatches(_state.value)) {
                    _state.update {
                        sm.onPosition(
                            it,
                            positionMs = p.currentPosition.coerceAtLeast(0L),
                            durationMs = if (p.duration > 0) p.duration else 0,
                        )
                    }
                }
            }
        }
    }

    /** Test helper: block until [predicate] holds (device tests only). */
    fun awaitState(timeoutMs: Long = 30_000, predicate: (PlayerSnapshot) -> Boolean): PlayerSnapshot =
        runBlocking {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                val s = _state.value
                if (predicate(s)) return@runBlocking s
                delay(200)
            }
            _state.value
        }
}
