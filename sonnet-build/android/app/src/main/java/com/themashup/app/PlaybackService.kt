package com.themashup.app

import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import java.io.IOException

/**
 * Hosts ExoPlayer + MediaSession. Media3 posts the ongoing notification (play/pause/next/previous)
 * and exposes lock-screen controls automatically. Tracks are queued as "mashup://track?..." URIs
 * and resolved to a real stream lazily on the loading thread, so ExoPlayer pre-buffers the next item (gapless).
 */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36")
            .setConnectTimeoutMs(10_000).setReadTimeoutMs(15_000).setAllowCrossProtocolRedirects(true)
        val upstream = DefaultDataSource.Factory(this, http)
        val resolving = ResolvingDataSource.Factory(upstream) { spec: DataSpec ->
            if (spec.uri.scheme == "mashup") resolve(spec) else spec
        }
        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(resolving))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(20_000, 60_000, 1_500, 3_000).build())
            .build()
        session = MediaSession.Builder(this, player).build()
    }

    private fun resolve(spec: DataSpec): DataSpec {
        val q = spec.uri
        val id = q.getQueryParameter("id") ?: throw IOException("Missing track id")
        // 1) offline copy wins
        Graph.library.downloadedPath(id)?.let { return spec.withUri(Uri.fromFile(java.io.File(it))) }
        // 2) public sources with failover
        val track = Track(
            id = id,
            title = q.getQueryParameter("title") ?: "",
            artist = q.getQueryParameter("artist") ?: "",
            previewUrl = q.getQueryParameter("preview"),
        )
        val r = Sources.resolveStream(track) ?: throw IOException("No playable source found for “${track.title}”")
        PlayerController.lastKind = r.kind
        return spec.withUri(Uri.parse(r.url))
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}

fun Track.toMediaItem(): MediaItem {
    val uri = Uri.Builder().scheme("mashup").authority("track")
        .appendQueryParameter("id", id).appendQueryParameter("title", title).appendQueryParameter("artist", artist)
        .apply { previewUrl?.let { appendQueryParameter("preview", it) } }
        .build()
    val extras = android.os.Bundle().apply {
        putInt("duration", duration ?: 0)
        putString("preview", previewUrl)
    }
    return MediaItem.Builder()
        .setMediaId(id)
        .setUri(uri)
        .setMediaMetadata(
            androidx.media3.common.MediaMetadata.Builder()
                .setTitle(title).setArtist(artist).setAlbumTitle(album)
                .setArtworkUri(artwork?.let { Uri.parse(it) })
                .setExtras(extras)
                .build(),
        )
        .build()
}

fun MediaItem.toTrack(): Track {
    val m = mediaMetadata
    val dur = m.extras?.getInt("duration") ?: 0
    return Track(
        id = mediaId,
        title = m.title?.toString() ?: "",
        artist = m.artist?.toString() ?: "",
        album = m.albumTitle?.toString(),
        artwork = m.artworkUri?.toString(),
        duration = dur.takeIf { it > 0 },
        previewUrl = m.extras?.getString("preview"),
    )
}
