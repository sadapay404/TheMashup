package local.themashup.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import local.themashup.music.core.domain.Track
import local.themashup.music.core.domain.formatDuration
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Song row — web `SearchRows.TrackRow`: art + title/artist + duration +
 * play affordance; active row highlighted when it is the current track.
 */
@Composable
fun TrackRow(
    track: Track,
    isCurrent: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onDownload: ((Track) -> Unit)? = null,
    trailing: @Composable () -> Unit = {},
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(if (isCurrent) tokens.surface2 else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Artwork(
            src = track.artworkBest ?: track.artwork,
            label = track.title,
            corner = 8.dp,
            modifier = Modifier.size(44.dp),
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                text = track.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (isCurrent) tokens.accent else scheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = track.artistNames,
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textDim,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = formatDuration(track.durationSec),
            style = MaterialTheme.typography.labelMedium,
            color = tokens.textFaint,
            modifier = Modifier.padding(start = 4.dp, end = 6.dp),
        )
        if (onDownload != null) {
            androidx.compose.material3.IconButton(
                onClick = { onDownload(track) },
                modifier = Modifier.size(34.dp),
            ) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = "Download",
                    tint = tokens.textDim,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        trailing()
    }
}
