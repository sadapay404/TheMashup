package com.themashup.app

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.min

/**
 * UI-facing playback facade over a Media3 MediaController. Must be used from the main thread.
 * Playback state machine: IDLE, LOADING, PLAYING, PAUSED, ERROR, STOPPED.
 * Crossfade is implemented as a fade-out/fade-in through the volume (single ExoPlayer instance).
 * Equalizer / normalization are tracked as state only (no android.media.audiofx binding).
 */
@UnstableApi
class PlayerController(private val app: Context, private val scope: CoroutineScope) {
    companion object {
        @Volatile var lastKind: String = "full"
    }

    private var controller: MediaController? = null
    private val pending = mutableListOf<(MediaController) -> Unit>()
    private var settings = Settings()
    private var lastFactor = 1f
    private var errorSkips = 0

    private val _queue = MutableStateFlow<List<Track>>(emptyList())
    val queue: StateFlow<List<Track>> = _queue
    private val _index = MutableStateFlow(0)
    val index: StateFlow<Int> = _index
    private val _state = MutableStateFlow(PState.IDLE)
    val state: StateFlow<PState> = _state
    private val _position = MutableStateFlow(0L)
    val position: StateFlow<Long> = _position
    private val _duration = MutableStateFlow(0L)
    val duration: StateFlow<Long> = _duration
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    private val _note = MutableStateFlow<String?>(null)
    val note: StateFlow<String?> = _note
    private val _sleepEnd = MutableStateFlow<Long?>(null)
    val sleepEnd: StateFlow<Long?> = _sleepEnd

    val current: Track? get() = _queue.value.getOrNull(_index.value)

    private var sleepJob: Job? = null

    init {
        scope.launch {
            Graph.prefs.settings.collect { s ->
                val old = settings
                settings = s
                controller?.let { c ->
                    if (old.repeat != s.repeat || controller?.repeatMode != s.repeat.toPlayerMode()) c.repeatMode = s.repeat.toPlayerMode()
                    if (c.shuffleModeEnabled != s.shuffle) c.shuffleModeEnabled = s.shuffle
                    if (c.playbackParameters.speed != s.rate) c.setPlaybackSpeed(s.rate)
                }
            }
        }
        connect()
        scope.launch { ticker() }
    }

    private fun Repeat.toPlayerMode() = when (this) {
        Repeat.OFF -> Player.REPEAT_MODE_OFF
        Repeat.ALL -> Player.REPEAT_MODE_ALL
        Repeat.ONE -> Player.REPEAT_MODE_ONE
    }

    private fun connect() {
        val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
        val future = MediaController.Builder(app, token).buildAsync()
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            c.repeatMode = settings.repeat.toPlayerMode()
            c.shuffleModeEnabled = settings.shuffle
            c.setPlaybackSpeed(settings.rate)
            sync(c)
            pending.toList().forEach { it(c) }
            pending.clear()
        }, ContextCompat.getMainExecutor(app))
    }

    /** Runs [block] as soon as the controller is connected (used by queue actions and the widget). */
    fun whenReady(block: (MediaController) -> Unit) {
        val c = controller
        if (c != null) block(c) else pending += block
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = sync(player)
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            mediaItem?.let {
                Graph.library.addHistory(it.toTrack())
                errorSkips = 0
                _error.value = null
                _note.value = null
            }
        }
        override fun onPlayerError(error: PlaybackException) {
            _error.value = error.cause?.message ?: error.message ?: "Playback failed"
            val c = controller ?: return
            // Skip to the next item once per failure so one bad stream doesn't stall the queue.
            if (c.hasNextMediaItem() && errorSkips < 3) {
                errorSkips++
                scope.launch {
                    delay(600)
                    c.seekToNextMediaItem()
                    c.prepare()
                    c.play()
                }
            }
        }
    }

    private fun sync(p: Player) {
        val items = (0 until p.mediaItemCount).map { p.getMediaItemAt(it).toTrack() }
        _queue.value = items
        _index.value = p.currentMediaItemIndex.coerceAtLeast(0)
        _duration.value = if (p.duration > 0) p.duration else (items.getOrNull(p.currentMediaItemIndex)?.duration?.times(1000L) ?: 0L)
        _state.value = when {
            _error.value != null && p.playbackState == Player.STATE_IDLE -> PState.ERROR
            p.playbackState == Player.STATE_IDLE -> if (items.isEmpty()) PState.IDLE else PState.STOPPED
            p.playbackState == Player.STATE_BUFFERING -> PState.LOADING
            p.playbackState == Player.STATE_READY -> if (p.playWhenReady) PState.PLAYING else PState.PAUSED
            else -> PState.STOPPED
        }
        if (_state.value == PState.PLAYING) {
            if (lastKind == "preview") _note.value = "Full-length sources are unavailable — playing a 30s preview."
        }
        MashupWidget.publish(app, items.getOrNull(p.currentMediaItemIndex), _state.value == PState.PLAYING)
    }

    private suspend fun ticker() {
        while (true) {
            delay(250)
            val c = controller ?: continue
            _position.value = c.currentPosition.coerceAtLeast(0)
            if (c.duration > 0) _duration.value = c.duration
            applyVolume(c)
        }
    }

    /** Volume = user volume x normalization headroom x crossfade fade factor. */
    private fun applyVolume(c: MediaController) {
        var factor = 1f
        val cf = settings.crossfade * 1000L
        val dur = c.duration
        if (cf > 0 && dur > cf * 2 && c.isPlaying) {
            val pos = c.currentPosition
            val remaining = dur - pos
            if (remaining < cf) factor = min(factor, (remaining.toFloat() / cf).coerceIn(0f, 1f))
            if (pos < cf) factor = min(factor, (0.1f + 0.9f * pos / cf).coerceIn(0f, 1f))
        }
        val norm = if (settings.normalize) 1f - 0.3f * (settings.normStrength / 100f) else 1f
        val v = (settings.volume * norm * factor).coerceIn(0f, 1f)
        if (kotlin.math.abs(v - lastFactor) > 0.01f) {
            lastFactor = v
            c.volume = v
        }
    }

    /* ---------- commands ---------- */
    fun playQueue(tracks: List<Track>, start: Int = 0) {
        if (tracks.isEmpty()) return
        _error.value = null
        _note.value = null
        errorSkips = 0
        whenReady { c ->
            c.setMediaItems(tracks.map { it.toMediaItem() }, start.coerceIn(0, tracks.size - 1), 0L)
            c.prepare()
            c.play()
        }
    }

    fun jumpTo(i: Int) = whenReady { c ->
        if (i in 0 until c.mediaItemCount) {
            c.seekTo(i, 0L)
            c.prepare()
            c.play()
        }
    }

    fun toggle() = whenReady { c ->
        when {
            c.isPlaying -> c.pause()
            c.playbackState == Player.STATE_ENDED -> { c.seekTo(0, 0L); c.play() }
            c.playbackState == Player.STATE_IDLE && c.mediaItemCount > 0 -> { c.prepare(); c.play() }
            else -> c.play()
        }
    }

    fun play() = whenReady { it.play() }
    fun pause() = whenReady { it.pause() }
    fun next() = whenReady { if (it.hasNextMediaItem()) it.seekToNextMediaItem() }
    fun prev() = whenReady { if (it.currentPosition > 3000 || !it.hasPreviousMediaItem()) it.seekTo(0) else it.seekToPreviousMediaItem() }
    fun seekTo(ms: Long) = whenReady { it.seekTo(ms) }

    fun addToQueue(t: Track) {
        if (_queue.value.isEmpty()) return playQueue(listOf(t))
        whenReady { it.addMediaItem(t.toMediaItem()) }
    }

    fun playNext(t: Track) {
        if (_queue.value.isEmpty()) return playQueue(listOf(t))
        whenReady { it.addMediaItem(it.currentMediaItemIndex + 1, t.toMediaItem()) }
    }

    fun removeFromQueue(i: Int) = whenReady { if (i in 0 until it.mediaItemCount) it.removeMediaItem(i) }
    fun move(from: Int, to: Int) = whenReady { if (from in 0 until it.mediaItemCount && to in 0 until it.mediaItemCount) it.moveMediaItem(from, to) }

    fun clearQueue() = whenReady { c ->
        val cur = c.currentMediaItemIndex
        for (i in c.mediaItemCount - 1 downTo 0) if (i != cur) c.removeMediaItem(i)
    }

    /** 0 = off */
    fun setSleepTimer(minutes: Int) {
        sleepJob?.cancel()
        if (minutes <= 0) {
            _sleepEnd.value = null
            return
        }
        _sleepEnd.value = System.currentTimeMillis() + minutes * 60_000L
        sleepJob = scope.launch {
            delay(minutes * 60_000L)
            pause()
            _sleepEnd.value = null
        }
    }
}
