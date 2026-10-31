package local.themashup.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.themashup.music.core.data.DownloadsRepository
import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.domain.DownloadStatus
import local.themashup.music.core.domain.formatBytes
import local.themashup.music.core.domain.formatSpeed
import local.themashup.music.core.domain.formatTimeLeft
import local.themashup.music.core.download.DownloadEngine
import local.themashup.music.core.download.FfmpegManager
import local.themashup.music.core.download.FfmpegState
import local.themashup.music.ui.components.Artwork
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Downloads page — web `DownloadsPage` port: header subtitle + ffmpeg/live
 * pills, "In progress" / "Finished" sections, dashed empty state. Jobs come
 * from the JSON-backed repository; rows already saved land in system
 * Downloads automatically (scoped storage), so completed rows show
 * size + "ready" without an extra Save step.
 */
@Composable
fun DownloadsScreen(
    downloads: DownloadsRepository,
    engine: DownloadEngine,
    ffmpegManager: FfmpegManager,
    onFindSomething: () -> Unit,
    onOpenSetup: () -> Unit,
    onPlay: (DownloadJob) -> Unit,
    onQueue: (DownloadJob) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val state by downloads.state.collectAsState()
    val ffmpegStatus by ffmpegManager.status.collectAsState()

    val active = state.jobs.filter {
        it.status == DownloadStatus.QUEUED ||
            it.status == DownloadStatus.DOWNLOADING ||
            it.status == DownloadStatus.PROCESSING
    }
    val failed = state.jobs.filter { it.status == DownloadStatus.FAILED }
    val audio = state.jobs.filter { it.status == DownloadStatus.COMPLETED && !it.container.equals("mp4", ignoreCase = true) }
    val videos = state.jobs.filter { it.status == DownloadStatus.COMPLETED && it.container.equals("mp4", ignoreCase = true) }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().widthIn(max = 768.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Column {
                    Text(
                        text = if (active.isNotEmpty()) "${active.size} in progress" else "Everything you download, in one place",
                        style = MaterialTheme.typography.bodyMedium, color = tokens.textDim,
                        modifier = Modifier.padding(bottom = 10.dp),
                    )
                    FfmpegPill(
                        ready = ffmpegStatus == FfmpegState.Ready,
                        working = ffmpegStatus is FfmpegState.Downloading || ffmpegStatus is FfmpegState.Extracting,
                        onClick = { if (ffmpegStatus != FfmpegState.Ready) onOpenSetup() },
                    )
                    Spacer(Modifier.height(16.dp))
                }
            }
            if (active.isNotEmpty()) {
                item { SectionTitle("In progress") }
                items(active, key = { "active-" + it.id }) { job -> ProgressRow(job, onCancel = { engine.cancel(job.id) }) }
            }
            if (failed.isNotEmpty()) {
                item { SectionTitle("Needs attention") }
                items(failed, key = { "failed-" + it.id }) { job -> FinishedRow(job, onRetry = { engine.retry(job.id) }) }
            }
            if (audio.isNotEmpty()) {
                item { SectionTitle("Downloaded songs") }
                items(audio, key = { "audio-" + it.id }) { job ->
                    FinishedRow(job, onRetry = { engine.retry(job.id) }, onPlay = { onPlay(job) }, onQueue = { onQueue(job) })
                }
            }
            if (videos.isNotEmpty()) {
                item { SectionTitle("Downloaded videos") }
                items(videos, key = { "video-" + it.id }) { job ->
                    FinishedRow(job, onRetry = { engine.retry(job.id) }, onPlay = { onPlay(job) }, onQueue = { onQueue(job) })
                }
            }
            if (state.jobs.isEmpty()) item { EmptyDownloads(onFindSomething) }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    val tokens = LocalMashupTokens.current
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = tokens.textDim,
        letterSpacing = 1.4.sp,
        modifier = Modifier.padding(bottom = 10.dp),
    )
}

@Composable
private fun FfmpegPill(ready: Boolean, working: Boolean, onClick: () -> Unit) {
    val tokens = LocalMashupTokens.current
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .border(
                width = 1.dp,
                color = if (ready) tokens.accent.copy(alpha = 0.4f) else tokens.border,
                shape = CircleShape,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (ready) {
            Icon(
                Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = tokens.accent,
                modifier = Modifier.size(12.dp),
            )
            Text("ffmpeg ready", style = MaterialTheme.typography.labelSmall, color = tokens.accent)
        } else {
            androidx.compose.material3.CircularProgressIndicator(
                modifier = Modifier.size(11.dp),
                strokeWidth = 1.5.dp,
                color = if (working) tokens.accent else tokens.textFaint,
            )
            Text(
                "transcoding limited",
                style = MaterialTheme.typography.labelSmall,
                color = tokens.textDim,
            )
        }
    }
}

/** 44dp music tile — web `Art` (Music2 glyph on base-3). */
@Composable
private fun JobArt(job: DownloadJob) {
    val tokens = LocalMashupTokens.current
    val image = job.track?.artworkBest ?: job.track?.artwork
    if (!image.isNullOrBlank()) {
        Artwork(src = image, label = job.title, corner = 7.dp, modifier = Modifier.size(44.dp))
        return
    }
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(tokens.surface2),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.MusicNote,
            contentDescription = null,
            tint = tokens.textFaint,
            modifier = Modifier.size(16.dp),
        )
    }
}

private fun statusLabel(status: DownloadStatus): String =
    status.name.lowercase().replaceFirstChar { it.uppercaseChar() }

@Composable
private fun ProgressRow(job: DownloadJob, onCancel: () -> Unit) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val pct = job.progress.coerceIn(0, 100)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, tokens.border, RoundedCornerShape(10.dp))
            .background(tokens.surface2)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        JobArt(job)
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                text = job.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = scheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = buildString {
                    append("${job.container.uppercase()} · ${job.quality} · ${statusLabel(job.status)}")
                    if (job.status == DownloadStatus.DOWNLOADING && (job.speedBps ?: 0) > 0) append(" · ${formatSpeed(job.speedBps)}")
                    if ((job.etaSec ?: 0) > 0) append(" · ${formatTimeLeft(job.etaSec!!.toDouble())}")
                },
                style = MaterialTheme.typography.labelSmall, color = tokens.textDim,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 3.dp),
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(tokens.border),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction = pct / 100f)
                        .height(6.dp)
                        .clip(CircleShape)
                        .background(tokens.accent),
                )
            }
        }
        Column(
            modifier = Modifier.padding(start = 10.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "$pct%",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                color = tokens.textDim,
            )
            IconButton(
                onClick = onCancel,
                modifier = Modifier.size(30.dp),
            ) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "Cancel download",
                    tint = tokens.textDim,
                    modifier = Modifier.size(15.dp),
                )
            }
        }
    }
}

@Composable
private fun ContainerBadge(job: DownloadJob) {
    val tokens = LocalMashupTokens.current
    Text(
        text = "${job.container} · ${job.quality}".uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
        fontWeight = FontWeight.SemiBold,
        color = tokens.textDim,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(tokens.border.copy(alpha = 0.45f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
private fun FinishedRow(
    job: DownloadJob,
    onRetry: () -> Unit,
    onPlay: (() -> Unit)? = null,
    onQueue: (() -> Unit)? = null,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val failed = job.status == DownloadStatus.FAILED
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, tokens.border, RoundedCornerShape(10.dp))
            .background(tokens.surface2)
            .clickable(
                enabled = !failed && onPlay != null,
                role = Role.Button,
                onClickLabel = if (job.container.equals("mp4", ignoreCase = true)) "Watch downloaded video" else "Play downloaded song",
                onClick = { onPlay?.invoke() },
            )
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        JobArt(job)
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                text = job.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = scheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!failed && !job.track?.artistNames.isNullOrBlank()) {
                Text(
                    text = job.track?.artistNames.orEmpty(),
                    style = MaterialTheme.typography.labelSmall,
                    color = tokens.textDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = if (failed) job.error ?: "Download failed" else "${job.container.uppercase()} · ${job.quality} · ${formatBytes(job.filesize)}",
                style = MaterialTheme.typography.labelSmall,
                color = if (failed) scheme.error else tokens.textDim,
                maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
            if (!failed && !job.warning.isNullOrBlank()) {
                Text(job.warning, style = MaterialTheme.typography.labelSmall, color = tokens.textDim, maxLines = 3)
            }
        }
        if (failed) {
            IconButton(onClick = onRetry, modifier = Modifier.size(44.dp)) {
                Icon(Icons.Outlined.Refresh, contentDescription = "Resume download", tint = tokens.textDim)
            }
        } else {
            if (onQueue != null) {
                IconButton(onClick = onQueue, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Filled.PlaylistAdd, contentDescription = "Add ${job.title} to queue", tint = tokens.textDim)
                }
            }
            if (onPlay != null) {
                IconButton(onClick = onPlay, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = "Play ${job.title}", tint = tokens.accent)
                }
            }
        }
    }
}

@Composable
private fun EmptyDownloads(onFindSomething: () -> Unit) {
    val tokens = LocalMashupTokens.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, tokens.border, RoundedCornerShape(10.dp))
            .padding(horizontal = 24.dp, vertical = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            Icons.Outlined.CloudDownload,
            contentDescription = null,
            tint = tokens.textFaint,
            modifier = Modifier.size(40.dp),
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "No downloads yet",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = tokens.textDim,
            )
            Text(
                text = "Hit the download icon on any track and pick a quality — " +
                    "MP3, FLAC, Opus or MP4 video.",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textFaint,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(tokens.accent)
                .clickable(onClick = onFindSomething)
                .padding(horizontal = 16.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                tint = tokens.accentContrast,
                modifier = Modifier.size(15.dp),
            )
            Text(
                text = "Find something",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = tokens.accentContrast,
            )
        }
    }
}
