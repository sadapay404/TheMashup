package local.themashup.music.ui.player

import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.PlaylistPlay
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.core.content.ContextCompat
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.request.ImageRequest
import android.content.pm.PackageManager
import local.themashup.music.core.data.LibraryRepository
import local.themashup.music.core.network.ExtractionService
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.core.player.PlayerSnapshot
import local.themashup.music.ui.components.Artwork
import local.themashup.music.ui.components.LikeButton
import local.themashup.music.ui.components.PlayerVisualizer
import local.themashup.music.ui.lyrics.LyricsPanel
import local.themashup.music.ui.theme.LocalArtAccents
import local.themashup.music.ui.theme.LocalMashupTokens

/**
 * Fullscreen player — web `player/ExpandedPlayer`: dynamic blurred artwork
 * background (per-theme `--art-opacity`), collapse pill, context label +
 * failover note, artwork with the decorative spinning vinyl (shown ≥600dp,
 * web `sm:` breakpoint), title/artist, seek + transport, and the
 * Lyrics/Queue tab panel. Visualizer (N8) and Download (N7) intentionally
 * land later.
 */
@Composable
fun ExpandedPlayer(
    state: PlayerSnapshot,
    engine: PlaybackEngine,
    library: LibraryRepository,
    extraction: ExtractionService,
    playerTab: String,
    onTabChange: (String) -> Unit,
    onCollapse: () -> Unit,
    modifier: Modifier = Modifier,
    onDownload: ((local.themashup.music.core.domain.Track) -> Unit)? = null,
    visualizerOn: Boolean = true,
    onToggleVisualizer: () -> Unit = {},
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    val accents = LocalArtAccents.current
    val context = LocalContext.current

    // RECORD_AUDIO enables the session FFT; asked at most once per process —
    // denial keeps the web's idle-sine bars (never an error).
    var askedPermission by rememberSaveable { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) engine.retryVisualizer()
    }
    androidx.compose.runtime.LaunchedEffect(visualizerOn) {
        if (visualizerOn && !askedPermission) {
            askedPermission = true
            val granted = ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.RECORD_AUDIO,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) permissionLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
        }
    }

    val current = state.current
    val artworkUrl = current?.artworkBest ?: current?.artwork
    val playing = state.status == local.themashup.music.core.player.PlayStatus.PLAYING
    val failoverUsed = (state.failover?.activeIndex ?: 0) + (state.failover?.refreshesUsed ?: 0)
    val contextLabel = when (state.contextLabel) {
        "radio" -> "ENDLESS RADIO"
        null, "" -> "NOW PLAYING"
        else -> state.contextLabel!!.uppercase()
    }

    // N9 beat envelope from the visualizer — art breathes, glow surges.
    val beat = remember { mutableStateOf(0f) }
    androidx.compose.runtime.LaunchedEffect(visualizerOn) { if (!visualizerOn) beat.value = 0f }
    Box(modifier = modifier.fillMaxSize().graphicsLayer { alpha = 1f }) {
        // ── dynamic artwork background — N9: full-vivid (the old theme
        // artOpacity 0.14–0.32 made the screen feel "way too transparent"),
        // soft-blurred with a deck-solid scrim so text sits on real surface.
        if (artworkUrl != null) {
            val blurMod = if (android.os.Build.VERSION.SDK_INT >= 31) Modifier.blur(34.dp) else Modifier
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current).data(artworkUrl).build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alpha = 1f,
                modifier = Modifier
                    .fillMaxSize()
                    .then(blurMod)
                    .graphicsLayer {
                        val p = beat.value
                        scaleX = 1.03f + 0.035f * p
                        scaleY = 1.03f + 0.035f * p
                    },
            )
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to scheme.background.copy(alpha = 0.34f),
                        0.42f to scheme.background.copy(alpha = 0.70f),
                        0.78f to scheme.background.copy(alpha = 0.96f),
                        1f to scheme.background,
                    ),
                ),
        )
        // Web: radial-gradient(60% 50% at 30% 20%, art-1 40% → transparent 70%)
        // N9: surges with the beat envelope (draws read `beat`, so each pulse
        // invalidates the layer — no recomposition).
        Box(
            modifier = Modifier
                .fillMaxSize()
                .drawBehind {
                    val p = beat.value
                    val brush = Brush.radialGradient(
                        0f to accents.first.copy(alpha = 0.36f + 0.36f * p),
                        0.7f to Color.Transparent,
                        center = androidx.compose.ui.geometry.Offset(
                            size.width * 0.30f,
                            size.height * 0.20f,
                        ),
                        radius = size.minDimension * (0.9f + 0.15f * p),
                    )
                    drawRect(brush = brush)
                },
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            // ── header ────────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(scheme.surface)
                        .clickable(onClick = onCollapse)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = tokens.textDim, modifier = Modifier.size(18.dp))
                    Text("Collapse", color = tokens.textDim, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                    Text(
                        text = contextLabel,
                        color = accents.first,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.2.sp,
                    )
                    if (failoverUsed > 0) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = tokens.textFaint, modifier = Modifier.size(12.dp))
                            Text(
                                text = " seamless fallback used ×$failoverUsed",
                                color = tokens.textFaint,
                                fontSize = 10.sp,
                            )
                        }
                    }
                }
                if (current != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        // Web header: Activity toggle → download → like.
                        Icon(
                            Icons.Outlined.GraphicEq,
                            contentDescription = if (visualizerOn) "Visualizer on" else "Visualizer off",
                            tint = if (visualizerOn) scheme.onBackground else scheme.onBackground.copy(alpha = 0.5f),
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .clickable(onClick = onToggleVisualizer)
                                .padding(7.dp),
                        )
                        if (onDownload != null) {
                            Icon(
                                Icons.Outlined.Download,
                                contentDescription = "Download",
                                tint = tokens.textDim,
                                modifier = Modifier
                                    .size(34.dp)
                                    .clip(CircleShape)
                                    .clickable { onDownload(current) }
                                    .padding(7.dp),
                            )
                        }
                        LikeButton(track = current, library = library, size = 26.dp)
                    }
                } else {
                    Box(modifier = Modifier.size(46.dp))
                }
            }

            // ── art + meta + controls ─────────────────────────────────
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BoxWithConstraints(contentAlignment = Alignment.Center) {
                    val showVinyl = maxWidth >= 600.dp
                    Box(contentAlignment = Alignment.Center) {
                        if (showVinyl) {
                            VinylDisc(
                                playing = playing,
                                accent = accents.first,
                                modifier = Modifier
                                    .size(280.dp)
                                    .align(Alignment.CenterEnd)
                                    .graphicsLayer { alpha = 0.9f },
                            )
                        }
                        Artwork(
                            src = artworkUrl,
                            label = current?.title ?: "No track",
                            corner = 24.dp,
                            modifier = Modifier
                                .widthIn(max = 340.dp)
                                .fillMaxWidth(0.82f),
                        )
                    }
                }
                Column(
                    modifier = Modifier
                        .padding(top = 18.dp)
                        .widthIn(max = 480.dp)
                        .fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = current?.title ?: "Nothing playing",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                        color = scheme.onBackground,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = current?.artistNames ?: "Choose something from Home",
                        style = MaterialTheme.typography.bodyMedium,
                        color = tokens.textDim,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    SeekBar(
                        positionMs = state.positionMs,
                        durationMs = state.durationMs,
                        onSeek = { engine.seekTo(it) },
                        modifier = Modifier.padding(top = 14.dp),
                    )
                    PlayerControls(
                        state = state,
                        onShuffle = { engine.toggleShuffle() },
                        onPrev = { engine.prevTrack() },
                        onToggle = { engine.togglePlay() },
                        onNext = { engine.nextTrack() },
                        onRepeat = { engine.cycleRepeat() },
                        large = true,
                        modifier = Modifier.padding(top = 8.dp, bottom = 14.dp),
                    )

                    // Visualizer strip — web `mx-auto mt-5 h-16 max-w-lg opacity-90`.
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp)
                            .height(64.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .widthIn(max = 512.dp)
                                .height(64.dp)
                                .graphicsLayer { alpha = 0.9f },
                        ) {
                            PlayerVisualizer(
                                fft = { engine.visualizer.latestFft() },
                                enabled = visualizerOn,
                                onPulse = { beat.value = it },
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                }
            }

            // ── lyrics / queue tabs ───────────────────────────────────
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(scheme.surface)
                    .border(
                        width = 1.dp,
                        color = tokens.border,
                        shape = RoundedCornerShape(16.dp),
                    ),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    TabButton(
                        label = "Lyrics",
                        icon = { Icon(Icons.Outlined.Mic, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        selected = playerTab == "lyrics",
                        onClick = { onTabChange("lyrics") },
                        modifier = Modifier.weight(1f),
                    )
                    TabButton(
                        label = "Queue",
                        icon = { Icon(Icons.Outlined.PlaylistPlay, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        selected = playerTab == "queue",
                        onClick = { onTabChange("queue") },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (playerTab == "lyrics") {
                    LyricsPanel(
                        track = current,
                        positionMs = state.positionMs,
                        extraction = extraction,
                        onSeek = { engine.seekTo(it) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    QueueList(
                        state = state,
                        engine = engine,
                        library = library,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun TabButton(
    label: String,
    icon: @Composable () -> Unit,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) tokens.surface2 else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.graphicsLayer { alpha = if (selected) 1f else 0.7f },
        ) { icon() }
        Text(
            text = label,
            color = if (selected) scheme.onBackground else tokens.textDim,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 7.dp),
        )
    }
}

/** Decorative record — web `spin-art` (grooves + art-accent label). */
@Composable
private fun VinylDisc(playing: Boolean, accent: Color, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "vinyl")
    val rotation by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 9000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "vinyl-rotation",
    )
    val pausedFactor = if (playing) 1f else 0f
    Canvas(
        modifier = modifier
            .graphicsLayer {
                rotationZ = rotation * pausedFactor
                alpha = if (playing) 1f else 0.85f
            },
    ) {
        val r = size.minDimension / 2f
        drawCircle(color = Color(0xFF0C0C0F), radius = r)
        // grooves
        var gr = r * 0.94f
        while (gr > r * 0.42f) {
            drawCircle(
                color = Color.White.copy(alpha = 0.045f),
                radius = gr,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f),
            )
            gr -= 7f
        }
        drawCircle(color = accent, radius = r * 0.34f)
        drawCircle(color = Color(0xFF0C0C0F), radius = r * 0.07f)
        // sleeve edge
        drawCircle(
            color = Color.White.copy(alpha = 0.07f),
            radius = r - 1f,
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f),
        )
    }
}
