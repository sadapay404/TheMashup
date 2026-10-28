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

    /** Web parity: `Math.random()`-style rng for shuffle picks. */
    private var rng: () -> Double = { Random.nextDouble() }

    private val sm: PlaybackStateMachine get() = PlaybackStateMachine

    /* ── lifecycle: service attaches/detaches the player ──────────────────── */

    fun attachPlayer(p: ExoPlayer) {
        player = p
        p.addListener(playerListener)
        applyPlayerMirrors(_state.value)
    }

    fun detachPlayer(p: ExoPlayer) {
        p.removeListener(playerListener)
        if (player === p) player = null
    }

    /* ── UI / session commands ───────────────────────────────────────────── */

    fun playQueue(tracks: List<local.themashup.music.core.domain.Track>, startIndex: Int = 0, startAtMs: Long = 0) {
        ensureServiceStarted()
        dispatch { sm.playQueue(it, tracks, startIndex, startAtMs) }
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
    fun setRepeat(mode: RepeatMode) = dispatch { sm.setRepeat(it, mode) }
    fun cycleRepeat() = dispatch { sm.cycleRepeat(it) }
    fun setShuffle(on: Boolean) = dispatch { sm.setShuffle(it, on) }
    fun toggleShuffle() = dispatch { sm.setShuffle(it, !it.shuffle) }

    fun addNext(track: local.themashup.music.core.domain.Track) =
        dispatch { sm.enqueue(it, track, local.themashup.music.core.domain.InsertMode.NEXT) }

    fun addToEnd(track: local.themashup.music.core.domain.Track) =
        dispatch { sm.enqueue(it, track, local.themashup.music.core.domain.InsertMode.END) }

    fun removeFromQueue(index: Int) = dispatch { sm.remove(it, index) }
    fun moveInQueue(from: Int, to: Int) = dispatch { sm.move(it, from, to) }
    fun clearQueue() = dispatch(sm::clear)

    /** Tests/preview: deterministic shuffle sequence. */
    fun setRngForTesting(seedRng: () -> Double) {
        rng = seedRng
    }

    /* ── transition executor ─────────────────────────────────────────────── */

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

    private fun resolveAndLoad(effect: PlayerEffect.Resolve) {
        val track = effect.track
        scope.launch {
            val outcome = runCatching {
                withContext(Dispatchers.IO) { extraction().streams(track.id) }
            }
            outcome.onFailure { t ->
                val (s, e) = sm.onResolveFailed(
                    _state.value,
                    t.message ?: "Extraction failed",
                    _state.value.warnings,
                )
                _state.value = s
                e?.let { execute(it) }
                return@launch
            }
            val result = outcome.getOrThrow()
            // Stale guard: user skipped/cleared while we were resolving.
            if (_state.value.current?.id != track.id) return@launch
            val (s, e) = sm.onCandidatesResolved(
                _state.value,
                result.candidates,
                startAtMs = effect.startAtMs,
                isRefresh = effect.isRefresh,
            )
            _state.value = s.copy(
                warnings = (s.warnings + result.warnings).distinct().take(10),
            )
            e?.let { execute(it) }
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
        serviceStarted = true
        try {
            appContext.startService(Intent(appContext, TheMashupPlayerService::class.java))
        } catch (_: Exception) {
            // If the app is backgrounded, media3 restarts the service with the
            // notification; playback from foreground is the supported path.
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
                            positionMs = p.position.coerceAtLeast(0),
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
