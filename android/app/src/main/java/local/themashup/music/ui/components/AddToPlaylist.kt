package local.themashup.music.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.outlined.PlaylistPlay
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.domain.Track
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * “Add to playlist” — web `AddToPlaylistButton` (popover → anchored menu on
 * mobile): playlist list with done-check + “Create playlist & add” quick path
 * (name “My Playlist”, web-exact).
 */
@Composable
fun AddToPlaylistButton(
    track: Track,
    library: LibraryRepository,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var menuOpen by remember { mutableStateOf(false) }
    var doneId by remember { mutableStateOf<String?>(null) }
    val libState by library.state.collectAsState()

    Box(modifier = modifier) {
        Icon(
            Icons.Filled.PlaylistAdd,
            contentDescription = "Add to playlist",
            tint = tokens.textFaint,
            modifier = Modifier
                .size(20.dp)
                .clickable { menuOpen = true },
        )
        DropdownMenu(
            expanded = menuOpen,
            onDismissRequest = { menuOpen = false },
            modifier = Modifier.width(240.dp),
        ) {
            Text(
                text = "ADD TO PLAYLIST",
                color = tokens.textFaint,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.6.sp,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            )
            val playlists = libState.playlists
            if (playlists.isEmpty()) {
                Text(
                    text = "No playlists yet.",
                    color = tokens.textFaint,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
            playlists.forEach { pl ->
                val done = doneId == pl.id
                DropdownMenuItem(
                    text = {
                        Text(
                            text = pl.name,
                            color = scheme.onSurface,
                            fontSize = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    leadingIcon = {
                        Icon(Icons.Outlined.PlaylistPlay, contentDescription = null, tint = tokens.textDim, modifier = Modifier.size(16.dp))
                    },
                    trailingIcon = {
                        if (done) {
                            Icon(Icons.Filled.Check, contentDescription = "Added", tint = tokens.accent, modifier = Modifier.size(16.dp))
                        }
                    },
                    onClick = {
                        scope.launch {
                            library.addTrackToPlaylist(pl.id, track)
                            doneId = pl.id
                            kotlinx.coroutines.delay(700)
                            menuOpen = false
                            doneId = null
                        }
                    },
                )
            }
            DropdownMenuItem(
                text = {
                    Text(
                        text = "Create playlist & add",
                        color = tokens.accent,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                leadingIcon = {
                    Icon(Icons.Filled.PlaylistAdd, contentDescription = null, tint = tokens.accent, modifier = Modifier.size(16.dp))
                },
                onClick = {
                    scope.launch {
                        val created = library.createPlaylist("My Playlist")
                        library.addTrackToPlaylist(created.id, track)
                        doneId = created.id
                        kotlinx.coroutines.delay(700)
                        menuOpen = false
                        doneId = null
                    }
                },
            )
        }
    }
}
