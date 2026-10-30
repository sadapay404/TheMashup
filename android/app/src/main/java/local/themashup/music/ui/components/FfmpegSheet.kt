package local.themashup.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import local.themashup.music.core.download.FfmpegState
import local.themashup.music.core.domain.formatBytes
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * ffmpeg setup sheet (N9): the binary ships BUNDLED inside the APK — this
 * sheet verifies it on first use. Shown while jobs wait on consent, during
 * verification, or when reopened from the header chip. `pending` = workers
 * parked on an answer.
 */
@Composable
fun FfmpegSheet(
    status: FfmpegState,
    pending: Boolean,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme

    Dialog(
        onDismissRequest = {
            if (pending) onDecline() else onDismiss()
        },
    ) {
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = scheme.surface,
            tonalElevation = 0.dp,
            modifier = Modifier.widthIn(max = 440.dp),
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "One-time setup",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = scheme.onBackground,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = tokens.textDim,
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(17.dp))
                            .clickable {
                                if (pending) onDecline() else onDismiss()
                            }
                            .padding(8.dp),
                    )
                }

                Spacer(Modifier.height(12.dp))
                Text(
                    text = "Downloads convert through a static ffmpeg that ships inside " +
                        "the app — verified once on this device, no separate download. " +
                        "MP4 videos that are already MP4 can save without it.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tokens.textDim,
                )

                Spacer(Modifier.height(16.dp))
                when (status) {
                    FfmpegState.Ready -> Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            tint = tokens.accent,
                            modifier = Modifier.size(16.dp),
                        )
                        Text("ffmpeg ready", style = MaterialTheme.typography.bodyMedium, color = scheme.onBackground)
                    }

                    is FfmpegState.Downloading -> {
                        val total = status.totalBytes
                        val fraction =
                            if (total > 0) (status.bytesRead.toFloat() / total.toFloat()).coerceIn(0f, 1f) else 0f
                        LinearProgressIndicator(
                            progress = { fraction },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp)),
                            color = tokens.accent,
                            trackColor = tokens.surface2,
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = if (total > 0) {
                                    "${formatBytes(status.bytesRead)} / ${formatBytes(total)}"
                                } else {
                                    formatBytes(status.bytesRead)
                                },
                                style = MaterialTheme.typography.labelMedium,
                                color = tokens.textDim,
                                modifier = Modifier.weight(1f),
                            )
                            if (total > 0) {
                                Text(
                                    text = "${(fraction * 100).toInt()}%",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = tokens.textDim,
                                )
                            }
                        }
                    }

                    FfmpegState.Extracting -> Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CircularProgressIndicatorSmall(tokens.accent)
                        Text("Verifying bundled ffmpeg…", style = MaterialTheme.typography.bodyMedium, color = tokens.textDim)
                    }

                    is FfmpegState.Failed -> Text(
                        text = "Setup failed: ${status.message}",
                        style = MaterialTheme.typography.bodySmall,
                        color = scheme.error,
                    )

                    FfmpegState.Missing -> Unit
                }

                Spacer(Modifier.height(18.dp))
                val showActions = status !is FfmpegState.Downloading && status != FfmpegState.Extracting
                if (showActions) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        val primary = when (status) {
                            is FfmpegState.Failed -> "Try again"
                            FfmpegState.Ready -> "Done"
                            else -> "Verify ffmpeg"
                        }
                        Text(
                            text = primary,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = tokens.accentContrast,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(tokens.accent)
                                .clickable(enabled = status != FfmpegState.Ready) { onAccept() }
                                .padding(vertical = 10.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                        if (pending || status is FfmpegState.Failed) {
                            Text(
                                text = "Not now",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = tokens.textDim,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(1.dp, tokens.border, RoundedCornerShape(8.dp))
                                    .clickable { onDecline() }
                                    .padding(horizontal = 18.dp, vertical = 10.dp),
                            )
                        }
                    }
                } else {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CircularProgressIndicatorSmall(tokens.accent)
                        Text(
                            text = "Verifying bundled ffmpeg — keep this open",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.textDim,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CircularProgressIndicatorSmall(color: androidx.compose.ui.graphics.Color) {
    androidx.compose.material3.CircularProgressIndicator(
        modifier = Modifier.size(14.dp),
        strokeWidth = 1.5.dp,
        color = color,
    )
}
