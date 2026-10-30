package local.themashup.music.core.player

import android.content.Context
import android.content.Intent
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import kotlin.random.Random
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
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) {
    private val _state = MutableStateFlow(PlayerSnapshot())
    val state: StateFlow<PlayerSnapshot> = _state.asStateFlow()

    private var player: ExoPlayer? = null
    private var serviceStarted = false
    private var resolveGeneration = 0L

    /** Web parity: `Math.random()`-style rng for shuffle picks. */
    private var rng: () -> Double = { Random.nextDouble() }

    private val sm: PlaybackStateMachine get() = PlaybackStateMachine

    /* ── lifecycle: service attaches/detaches the player ──────────────────── */

    fun attachPlayer(p: ExoPlayer) {
        player = p
        p.addListener(playerListener)
        applyPlayerMirrors(_state.value)
        // Resolution can finish before the service attaches its player.
        val snapshot = _state.value
        if (snapshot.status == PlayStatus.LOADING) {
            snapshot.failover?.active?.let { loadCandidate(PlayerEffect.LoadCandidate(it, snapshot.positionMs)) }
        }
        startVisualizerPoller(p)
    }

    fun detachPlayer(p: Player) {
        p.removeListener(playerListener)
        if (player === p) {
            player = null
            vizPoller?.cancel()
            vizPoller = null
            visualizer.release()
        }
    }

    /* ── N8 visualizer: FFT feed for the expanded-player bar strip ──────── */

    /** Owns the `android.media.audiofx.Visualizer` (service attaches player). */
    val visualizer = OutputVisualizer()

    private var vizPoller: kotlinx.coroutines.Job? = null

    /**
     * The audio session id is unset until ExoPlayer finishes initializing the
     * output, so poll cheaply until bound; permission refusals back off to a
     * slow tick (cleared via [OutputVisualizer.allowRetry] after the grant).
     */
    private fun startVisualizerPoller(p: ExoPlayer) {
        vizPoller?.cancel()
        vizPoller = scope.launch {
            while (isActive) {
                // ExoPlayer is owned by the main looper; read its session ID here,
                // then do the potentially slow AudioEffect binding off the UI thread.
                val sessionId = OutputVisualizer.audioSessionIdOf(p)
                when (withContext(Dispatchers.IO) { visualizer.tryBind(sessionId) }) {
                    OutputVisualizer.BindOutcome.BOUND -> break
                    OutputVisualizer.BindOutcome.RETRY -> delay(1_000)
                    OutputVisualizer.BindOutcome.UNAVAILABLE -> delay(10_000)
                }
            }
        }
    }

    fun retryVisualizer() {
        visualizer.allowRetry()
        player?.let(::startVisualizerPoller)
    }

    /* ── UI / session commands ───────────────────────────────────────────── */

    fun playQueue(
        tracks: List<local.themashup.music.core.domain.Track>,
        startIndex: Int = 0,
        startAtMs: Long = 0,
        context: String? = null,
    ) {
        ensureServiceStarted()
        dispatch { sm.playQueue(it, tracks, startIndex, startAtMs, context) }
    }

    fun playNow(track: local.themashup.music.core.domain.Track, context: String? = null) {
        ensureServiceStarted()
        dispatch { sm.playNow(it, track, context) }
    }

    fun togglePlay() = dispatch(sm::toggle)
    fun nextTrack() = dispatch { sm.next(it, rng, manual = true) }
    fun prevTrack() {
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

    fun removeFromQueue(index: Int) = dispatch { sm.remove(it, index) }
    fun moveInQueue(from: Int, to: Int) = dispatchSimple { sm.move(it, from, to) }
    fun clearQueue() = dispatch(sm::clear)

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
                ensureServiceStarted()
                if (!effect.isRefresh) player?.pause()
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
                player?.stop()
                player?.clearMediaItems()
            }
            is PlayerEffect.Fail -> {
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
        val (advanced, effect) = sm.next(snapshot, rng, manual = false)
        val progressed = if (snapshot.shuffle) {
            advanced.cursor != snapshot.cursor
        } else {
            advanced.cursor > snapshot.cursor
        }
        if (progressed && effect != null) {
            _state.value = advanced
            applyPlayerMirrors(advanced)
            execute(effect)
            return
        }
        val (parked, fail) = sm.onResolveFailed(snapshot, message, snapshot.warnings)
        _state.value = parked
        applyPlayerMirrors(parked)
        fail?.let { execute(it) }
    }

    private fun resolveAndLoad(effect: PlayerEffect.Resolve) {
        val track = effect.track
        val generation = ++resolveGeneration
        scope.launch {
            val outcome = runCatching {
                withContext(Dispatchers.IO) { extraction().streams(track.id) }
            }
            if (generation != resolveGeneration || _state.value.current?.id != track.id) return@launch
            outcome.onFailure { t ->
                // N9: dead track → auto-advance; park only with no forward move.
                advanceOrPark(t.message ?: "Extraction failed")
                return@launch
            }
            val result = outcome.getOrThrow()
            // Stale guard: user skipped/cleared while we were resolving.
            if (_state.value.current?.id != track.id) return@launch
            val (s, e) = sm.onCandidatesResolved(
                _state.value,
                // Adaptive video streams are silent — playback only walks
                // audio + muxed candidates (N7 download plan uses the full list).
                result.candidates.filter { !it.videoOnly },
                startAtMs = effect.startAtMs,
                isRefresh = effect.isRefresh,
            )
            _state.value = s.copy(
                warnings = (s.warnings + result.warnings).distinct().take(10),
            )
            if (s.status == PlayStatus.ERROR) {
                advanceOrPark(s.error ?: "No playable streams")
            } else {
                e?.let { execute(it) }
            }
        }
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
        return DefaultMediaSourceFactory(httpFactory).createMediaSource(MediaItem.fromUri(c.url))
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

    private fun ensureServiceStarted() {
        if (serviceStarted) return
        try {
            appContext.startService(Intent(appContext, TheMashupPlayerService::class.java))
            serviceStarted = true
        } catch (_: Exception) {
            // Background-start restriction — retry on the next command instead
            // of latching the flag and never starting the notification service.
        }
    }

    /* ── player → machine ────────────────────────────────────────────────── */

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _state.update { sm.onPlayingChanged(it, isPlaying) }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
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
            val (next, effect) = sm.onCandidateFailed(_state.value)
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
                if (p.isPlaying || p.playbackState == Player.STATE_READY) {
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
