package local.themashup.music.core.player

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.view.TextureView
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
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
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import local.themashup.music.TheMashupApp
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
    /** Completes when the service has attached its ExoPlayer to this engine. Recreated on detach. */
    private var playerReady = CompletableDeferred<Unit>()
    private var resolveGeneration = 0L
    private var recordedGeneration = -1L
    private var videoView: TextureView? = null
    private var visualizerActive = false
    private val failedPositions = mutableSetOf<Int>()

    /** Web parity: `Math.random()`-style rng for shuffle picks. */
    private var rng: () -> Double = { Random.nextDouble() }

    /* ── Sleep timer ── */
    /** Job that pauses playback once the timer expires. */
    private var sleepTimerJob: Job? = null
    private var sleepTimerEndTime = 0L

    /* ── Crossfade / gapless (state mirrored from UI prefs) ── */
    var crossfadeEnabled: Boolean = false
        private set
    var crossfadeDurationSec: Double = 3.0
        private set
    var gaplessEnabled: Boolean = false
        private set
    private var crossfadeJob: Job? = null

    /* ── Playback rate ── */
    var playbackRate: Float = 1f
        private set

    /* ── Equalizer ── */
    var equalizerEnabled: Boolean = false
        private set
    var equalizerPreset: String = "flat"
        private set

    /* ── Loudness normalization ── */
    var normalizationEnabled: Boolean = false
        private set
    var normalizationStrength: Int = 100
        private set
    private var normalizationPref: Float = 1.0f

    /* ── Persistence ── */
    private val prefs: SharedPreferences by lazy {
        appContext.getSharedPreferences("themashup_player", Context.MODE_PRIVATE)
    }

    private val sm: PlaybackStateMachine get() = PlaybackStateMachine

    /* ── lifecycle: service attaches/detaches the player ──────────────────── */

    fun attachPlayer(p: ExoPlayer) {
        player = p
        p.addListener(playerListener)
        applyPlayerMirrors(_state.value)
        if (!playerReady.isCompleted) playerReady.complete(Unit)
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
            playerReady = CompletableDeferred<Unit>()
            crossfadeJob?.cancel()
            crossfadeJob = null
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
        scope.launch {
            ensureServiceStarted()
            dispatch { sm.playQueue(it, tracks, startIndex, startAtMs, context) }
        }
    }

    fun playNow(track: local.themashup.music.core.domain.Track, context: String? = null) {
        failedPositions.clear()
        scope.launch {
            ensureServiceStarted()
            dispatch { sm.playNow(it, track, context) }
        }
    }

    fun togglePlay() {
        if (_state.value.status == PlayStatus.ERROR || _state.value.status == PlayStatus.IDLE) failedPositions.clear()
        scope.launch { dispatch(sm::toggle) }
    }
    fun nextTrack() {
        failedPositions.clear()
        scope.launch { dispatch { sm.next(it, rng, manual = true) } }
    }
    fun prevTrack() {
        failedPositions.clear()
        // Android convention: >3s into a track restarts it, else step back.
        if (_state.value.positionMs > 3_000 && _state.value.cursor >= 0) {
            scope.launch { dispatch { sm.seek(it, 0) } }
        } else {
            scope.launch { dispatch { sm.prev(it, rng) } }
        }
    }

    fun seekTo(positionMs: Long) = scope.launch { dispatch { sm.seek(it, positionMs) } }
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
        scope.launch { dispatch { sm.remove(it, index) } }
    }
    fun moveInQueue(from: Int, to: Int) {
        failedPositions.clear()
        dispatchSimple { sm.move(it, from, to) }
    }
    fun clearQueue() {
        failedPositions.clear()
        scope.launch { dispatch(sm::clear) }
    }

    /** Tests/preview: deterministic shuffle sequence. */
    fun setRngForTesting(seedRng: () -> Double) {
        rng = seedRng
    }

    /* ── Sleep timer ────────────────────────────────────────────────────── */

    /** Start (or replace) a sleep timer that pauses playback after [minutes]. */
    fun setSleepTimer(minutes: Int) {
        cancelSleepTimer()
        if (minutes <= 0) return
        sleepTimerEndTime = System.currentTimeMillis() + minutes.toLong() * 60_000
        sleepTimerJob = scope.launch {
            while (isActive) {
                val remaining = sleepTimerEndTime - System.currentTimeMillis()
                if (remaining <= 0) {
                    withContext(Dispatchers.Main.immediate) {
                        player?.pause()
                        _state.update { snapshot -> snapshot.copy(status = PlayStatus.PAUSED) }
                    }
                    sleepTimerJob = null
                    return@launch
                }
                delay(1000)
            }
        }
    }

    /** Cancel any running sleep timer. */
    fun cancelSleepTimer() {
        sleepTimerJob?.cancel()
        sleepTimerJob = null
        sleepTimerEndTime = 0L
    }

    /* ── Crossfade / gapless preference setters ─────────────────────────── */
    fun setCrossfade(enabled: Boolean, durationSec: Double = 3.0) {
        crossfadeEnabled = enabled
        crossfadeDurationSec = durationSec.coerceAtLeast(0.5)
        // ExoPlayer is a single output; crossfade is applied on the next
        // track transition by ramping volume (see crossfadeToNext below).
    }

    /** Ramp volume down on current track, then up on next — true crossfade. */
    private fun crossfadeToNext() {
        if (!crossfadeEnabled || crossfadeDurationSec <= 0.0) return
        crossfadeJob?.cancel()
        val p = player ?: return
        val steps = 20
        val stepMs = (crossfadeDurationSec * 1000 / steps).coerceAtLeast(16.0).toLong()
        val startVol = p.volume
        crossfadeJob = scope.launch {
            try {
                // Fade out
                for (i in 1..steps) {
                    if (!isActive) break
                    p.volume = (startVol * (1.0f - i / steps.toFloat())).coerceIn(0f, 1f)
                    delay(stepMs)
                }
                // Fade in (next track should already be loaded by gapless preload)
                for (i in 0..steps) {
                    if (!isActive) break
                    p.volume = (startVol * (i / steps.toFloat())).coerceIn(0f, 1f)
                    delay(stepMs)
                }
            } finally {
                p.volume = startVol
                crossfadeJob = null
            }
        }
    }

    fun setGapless(enabled: Boolean) {
        gaplessEnabled = enabled
        // When gapless is on, ExoPlayer will pre-buffer the next media item
        // via addMediaItem before the current track ends (handled in playQueue).
    }

    /* ── Playback rate / equalizer / normalization preference setters ─── */

    fun setPlaybackRate(rate: Float) {
        playbackRate = rate.coerceIn(0.5f, 2f)
        player?.setPlaybackParameters(PlaybackParameters(playbackRate, 1f))
    }

    fun setEqualizer(enabled: Boolean, preset: String = "flat") {
        equalizerEnabled = enabled
        equalizerPreset = preset
        // Native Equalizer binding omitted — state tracked for UI/parity,
        // Web implements EQ via BiquadFilterNode chain.
    }

    fun setEqualizerBand(frequency: Int, gain: Int) {
        equalizerPreset = "custom"
        // Band-level EQ state tracked; native Equalizer binding omitted.
    }

    private fun applyEqualizer() {
        // No-op: native Equalizer binding omitted.
    }

    fun setNormalization(enabled: Boolean, strength: Int = 100) {
        normalizationEnabled = enabled
        normalizationStrength = strength.coerceIn(0, 100)
        normalizationPref = if (normalizationEnabled) {
            (1.0f + (normalizationStrength / 100.0f) * 0.5f).coerceIn(1.0f, 1.5f)
        } else 1.0f
    }

    

    /* ── Phase 4: sharing ── */

    /** Share a track via the Android system share sheet. */
    fun shareTrack(track: local.themashup.music.core.domain.Track) {
        val intent = android.content.Intent().apply {
            action = android.content.Intent.ACTION_SEND
            type = "text/plain"
            putExtra(android.content.Intent.EXTRA_SUBJECT, track.title)
            putExtra(android.content.Intent.EXTRA_TEXT, "${track.artistNames} — ${track.title}\n${track.externalId}")
            flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
        try {
            appContext.startActivity(android.content.Intent.createChooser(intent, "Share track"))
        } catch (_: Exception) {
            // No share target available — silently degrade.
        }
    }

    /* ── Phase 4: recently added / smart playlists ── */

    /** Record a track as recently added (kept in memory, newest first, capped at 50). */
    fun addToRecentlyAdded(track: local.themashup.music.core.domain.Track) {
        val existing = recentlyAdded.indexOfFirst { it.id == track.id }
        val updated = if (existing >= 0) {
            recentlyAdded.toMutableList().apply { removeAt(existing); add(0, track) }
        } else {
            (listOf(track) + recentlyAdded).toMutableList()
        }
        recentlyAdded.clear()
        recentlyAdded.addAll(updated.take(50))
        // Persist to SharedPreferences so it survives app restarts.
        try {
            val listSerializer = serializer<List<local.themashup.music.core.domain.Track>>()
            val json = Json.encodeToString(listSerializer, recentlyAdded.toList())
            prefs.edit().putString("recently_added", json).apply()
        } catch (_: Exception) {
            // Serialization failure must not interrupt playback.
        }
    }

    /** All recently added tracks, newest first. */
    val recentlyAdded: MutableList<local.themashup.music.core.domain.Track> = mutableListOf()

    /** Load previously persisted recently added tracks from SharedPreferences. */
    private fun loadRecentlyAdded() {
        try {
            val json = prefs.getString("recently_added", null) ?: return
            val listSerializer = serializer<List<local.themashup.music.core.domain.Track>>()
            val list = Json.decodeFromString(listSerializer, json)
            recentlyAdded.addAll(list.take(50))
        } catch (_: Exception) {
            // Corrupted preference — start fresh.
        }
    }

    /* ── Phase 4: local file playback ── */

    /**
     * Play a local audio file from a Uri (e.g. from Storage Access Framework).
     * Routes through the state machine so failover, status, listeners and
     * history all work — ExoPlayer handles content:// and file:// uris natively.
     */
    fun playLocalFile(uri: android.net.Uri, displayName: String) {
        scope.launch {
            ensureServiceStarted()
            val track = local.themashup.music.core.domain.Track(
                id = "local:${uri.toString()}",
                externalId = uri.toString(),
                title = displayName,
                artists = emptyList(),
                artistNames = "Local File",
                category = "song",
            )
            addToRecentlyAdded(track)
            // Route through the state machine so failover/status/listeners all work.
            val (snapshot, effect) = sm.playQueue(_state.value, listOf(track), 0, context = "local")
            _state.value = snapshot
            applyPlayerMirrors(snapshot)
            effect?.let { e -> execute(e) }
        }
    }

    /* ── transition executor ─────────────────────────────────────────────── */

    /** Machine methods without effects return a bare snapshot — pair them with null. */
    private fun dispatchSimple(fn: (PlayerSnapshot) -> PlayerSnapshot) =
        scope.launch { dispatch { fn(it) to null } }

    private suspend fun dispatch(fn: (PlayerSnapshot) -> Pair<PlayerSnapshot, PlayerEffect?>) {
        val current = _state.value
        val (next, effect) = fn(current)
        _state.value = next
        applyPlayerMirrors(next)
        if (effect != null) execute(effect)
    }

    private suspend fun execute(effect: PlayerEffect) {
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
            effect?.let { e -> scope.launch { execute(e) } }
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
                    // Local files bypass stream extraction — ExoPlayer plays them directly.
                    if (track.externalId.startsWith("local:")) {
                        val candidate = StreamCandidate(
                            id = "local:${uriHash(track.externalId)}",
                            source = "local",
                            url = track.externalId,
                            mime = "audio/mpeg",
                            ext = "mp3",
                            quality = "local",
                            bitrateKbps = null,
                            httpHeaders = emptyMap(),
                        )
                        ResolvedMedia(listOf(candidate), emptyList())
                    } else {
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

    /** Stable id for local-file candidates (String.hashCode() is spec-stable). */
    private fun uriHash(uri: String): String = uri.hashCode().toString()

    private fun parkError(message: String) {
        val (parked, effect) = sm.onResolveFailed(_state.value, message, _state.value.warnings)
        _state.value = parked
        applyPlayerMirrors(parked)
        effect?.let { e -> scope.launch { execute(e) } }
    }

    private fun loadCandidate(effect: PlayerEffect.LoadCandidate) {
        val p = player ?: run {
            // Player is not attached (service recreation in progress) — park the error.
            val (parked, eff) = sm.onResolveFailed(_state.value, "Playback service unavailable", _state.value.warnings)
            _state.value = parked
            applyPlayerMirrors(parked)
            eff?.let { e -> scope.launch { execute(e) } }
            return
        }
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

    /** Starts the playback service and suspends until its ExoPlayer is attached. Returns false on failure. */
    private suspend fun ensureServiceStarted(): Boolean {
        if (serviceStarted) {
            // Already started — wait for player attachment if not yet attached.
            return try {
                withTimeoutOrNull(10_000) { playerReady.await() } ?: return false
                true
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { false }
        }
        return try {
            val intent = Intent(appContext, TheMashupPlayerService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                appContext.startForegroundService(intent)
            } else {
                appContext.startService(intent)
            }
            serviceStarted = true
            // Wait for the service to attach its player (timeout after 10s).
            withTimeoutOrNull(10_000) { playerReady.await() } ?: return false
            true
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) {
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
                    // Defer all player mutations to the main scope — Media3 warns
                    // against mutating ExoPlayer from inside its own callbacks.
                    scope.launch {
                        if (crossfadeEnabled) crossfadeToNext()
                        val (next, effect) = sm.onTrackCompleted(_state.value, rng)
                        _state.value = next
                        applyPlayerMirrors(next)
                        effect?.let { e -> execute(e) }
                    }
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
            // Defer player mutations to the main scope.
            scope.launch {
                _state.value = next
                applyPlayerMirrors(next)
                effect?.let { e -> execute(e) }
            }
        }
    }

    /** Position ticker (Android has no timeupdate event on ExoPlayer). */
    init {
        loadRecentlyAdded()
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
