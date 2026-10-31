package local.themashup.music.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import local.themashup.music.core.data.AppContainer
import local.themashup.music.core.player.PlaybackEngine
import local.themashup.music.ui.components.ThemeSwatchPicker
import local.themashup.music.ui.logic.themeFromKey
import local.themashup.music.ui.theme.LocalMashupTokens

/** Settings page — web `SettingsPage` port. Exposes every playback feature
 * that lives in [PlaybackEngine] (sleep timer, crossfade, gapless, rate,
 * EQ, normalization) plus app settings (theme, visualizer, lyrics, quality)
 * and YouTube account state. Reachable from the bottom nav (5th tab). */
@Composable
fun SettingsScreen(
    container: AppContainer,
    onClose: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val engine = container.player
    val settings = container.settings
    val scope = rememberCoroutineScope()
    val tokens = LocalMashupTokens.current
    val scheme = MaterialTheme.colorScheme

    val themeKey by settings.themeKey.collectAsState()
    val visualizerOn by settings.visualizerOn.collectAsState(initialValue = true)
    val lyricsOn by settings.lyricsOn.collectAsState(initialValue = true)
    val audioQuality by settings.audioQuality.collectAsState(initialValue = "320k")
    val ytCookie by settings.youtubeCookie.collectAsState()

    val currentTheme = themeFromKey(themeKey)

    // ── Local UI state (mirrors engine/settings, committed on change) ──
    var sleepMinutes by remember { mutableStateOf(0) }
    var crossfade by remember { mutableStateOf(engine.crossfadeEnabled) }
    var crossfadeSec by remember { mutableStateOf(engine.crossfadeDurationSec.toFloat()) }
    var gapless by remember { mutableStateOf(engine.gaplessEnabled) }
    var rate by remember { mutableStateOf(engine.playbackRate) }
    var eqEnabled by remember { mutableStateOf(engine.equalizerEnabled) }
    var eqPreset by remember { mutableStateOf(engine.equalizerPreset) }
    var normEnabled by remember { mutableStateOf(engine.normalizationEnabled) }
    var normStrength by remember { mutableStateOf(engine.normalizationStrength.toFloat()) }

    val sleepOptions = listOf(0, 15, 30, 45, 60, 90, 120)
    val rateOptions = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)
    val eqPresets = listOf("flat", "bass", "vocal", "treble", "custom")
    val qualityOptions = listOf("128k", "192k", "256k", "320k")

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "Settings",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = scheme.onBackground,
            )
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = "Close", tint = scheme.onBackground)
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        sectionHeader("Playback")

        // Sleep timer
        settingRow(
            icon = null,
            title = "Sleep timer",
            subtitle = "Pause playback after ${if (sleepMinutes == 0) "off" else "$sleepMinutes min"}",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    sleepOptions.forEach { m ->
                        val selected = m == sleepMinutes
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (selected) tokens.accent else Color.Transparent)
                                .border(1.dp, if (selected) tokens.accent else tokens.border, RoundedCornerShape(8.dp))
                                .clickable { sleepMinutes = m; engine.setSleepTimer(m) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(text = m.toString(), color = if (selected) Color.White else tokens.textDim, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            },
        )

        divider()

        // Crossfade
        settingRow(
            icon = null,
            title = "Crossfade",
            subtitle = "Fade between tracks (${engine.crossfadeDurationSec.toInt()}s)",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val checked = crossfade
                    IconButton(onClick = { crossfade = !crossfade; engine.setCrossfade(crossfade, crossfadeSec) }) {
                        Icon(
                            imageVector = if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                            contentDescription = null,
                            tint = if (checked) tokens.accent else tokens.textDim,
                        )
                    }
                    Slider(
                        value = crossfadeSec,
                        onValueChange = { crossfadeSec = it; engine.setCrossfade(crossfade, it.toDouble()) },
                        valueRange = 0.5f..10f,
                        steps = 19,
                        enabled = crossfade,
                    )
                }
            },
        )

        divider()

        // Gapless
        settingRow(
            icon = null,
            title = "Gapless playback",
            subtitle = "Pre-buffer the next track",
            trailing = {
                val checked = gapless
                IconButton(onClick = { gapless = !gapless; engine.setGapless(gapless) }) {
                    Icon(
                        imageVector = if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                        contentDescription = null,
                        tint = if (checked) tokens.accent else tokens.textDim,
                    )
                }
            },
        )

        divider()

        // Playback rate
        settingRow(
            icon = null,
            title = "Playback rate",
            subtitle = "${engine.playbackRate.toString()}x",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    rateOptions.forEach { r ->
                        val selected = (r - rate).absoluteValue < 0.001f
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (selected) tokens.accent else Color.Transparent)
                                .border(1.dp, if (selected) tokens.accent else tokens.border, RoundedCornerShape(8.dp))
                                .clickable { rate = r; engine.setPlaybackRate(r) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(text = "${r}x", color = if (selected) Color.White else tokens.textDim, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            },
        )

        divider()

        // Equalizer
        settingRow(
            icon = null,
            title = "Equalizer",
            subtitle = "${eqPreset.capitalize()}${if (!eqEnabled) " (off)" else ""}",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val checked = eqEnabled
                    IconButton(onClick = { eqEnabled = !eqEnabled; engine.setEqualizer(eqEnabled, eqPreset) }) {
                        Icon(
                            imageVector = if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                            contentDescription = null,
                            tint = if (checked) tokens.accent else tokens.textDim,
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    eqPresets.forEach { p ->
                        val selected = p == eqPreset
                        Box(
                            modifier = Modifier
                                .height(30.dp)
                                .padding(horizontal = 2.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (selected) tokens.accent.copy(alpha = 0.15f) else Color.Transparent)
                                .border(1.dp, if (selected) tokens.accent else tokens.border, RoundedCornerShape(6.dp))
                                .clickable { eqPreset = p; engine.setEqualizer(eqEnabled, p) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(text = p.capitalize(), color = if (selected) tokens.accent else tokens.textDim, fontSize = 11.sp)
                        }
                    }
                }
            },
        )

        divider()

        // Normalization
        settingRow(
            icon = null,
            title = "Loudness normalization",
            subtitle = "Even out track volume (${engine.normalizationStrength}%)",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val checked = normEnabled
                    IconButton(onClick = { normEnabled = !normEnabled; engine.setNormalization(normEnabled, normStrength.toInt()) }) {
                        Icon(
                            imageVector = if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                            contentDescription = null,
                            tint = if (checked) tokens.accent else tokens.textDim,
                        )
                    }
                    Slider(
                        value = normStrength,
                        onValueChange = { normStrength = it; engine.setNormalization(normEnabled, it.toInt()) },
                        valueRange = 0f..100f,
                        steps = 20,
                        enabled = normEnabled,
                    )
                }
            },
        )

        Spacer(modifier = Modifier.height(24.dp))

        sectionHeader("Audio")

        // Visualizer
        settingRow(
            icon = null,
            title = "Visualizer",
            subtitle = "FFT bars on the expanded player",
            trailing = {
                val checked = visualizerOn
                IconButton(onClick = { scope.launch { settings.setVisualizerOn(!visualizerOn) } }) {
                    Icon(
                        imageVector = if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                        contentDescription = null,
                        tint = if (checked) tokens.accent else tokens.textDim,
                    )
                }
            },
        )

        divider()

        // Lyrics
        settingRow(
            icon = null,
            title = "Synced lyrics",
            subtitle = "LRC / LRCLIB lyrics panel",
            trailing = {
                val checked = lyricsOn
                IconButton(onClick = { scope.launch { settings.setLyricsOn(!lyricsOn) } }) {
                    Icon(
                        imageVector = if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                        contentDescription = null,
                        tint = if (checked) tokens.accent else tokens.textDim,
                    )
                }
            },
        )

        divider()

        // Audio quality
        settingRow(
            icon = null,
            title = "Audio quality",
            subtitle = "$audioQuality",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    qualityOptions.forEach { q ->
                        val selected = q == audioQuality
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (selected) tokens.accent else Color.Transparent)
                                .border(1.dp, if (selected) tokens.accent else tokens.border, RoundedCornerShape(8.dp))
                                .clickable { scope.launch { settings.setAudioQuality(q) } },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(text = q, color = if (selected) Color.White else tokens.textDim, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            },
        )

        Spacer(modifier = Modifier.height(24.dp))

        sectionHeader("Appearance")

        // Theme
        Text(
            text = "Theme",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = scheme.onBackground,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        ThemeSwatchPicker(current = currentTheme, onSelect = { scope.launch { settings.setThemeKey(it.storageKey) } })
        Text(
            text = "${currentTheme.label} — ${currentTheme.hint}",
            style = MaterialTheme.typography.bodySmall,
            color = tokens.textFaint,
            modifier = Modifier.padding(top = 4.dp),
        )

        Spacer(modifier = Modifier.height(24.dp))

        sectionHeader("Account")

        // YouTube sign-in
        settingRow(
            icon = null,
            title = "YouTube Music",
            subtitle = if (ytCookie.isNotBlank()) "Signed in" else "Sign in for recommendations",
            trailing = {
                IconButton(onClick = { /* handled by parent top bar */ }) {
                    Icon(Icons.Default.Send, contentDescription = null, tint = tokens.accent)
                }
            },
        )

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun sectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
}

@Composable
private fun divider() {
    Spacer(modifier = Modifier.height(12.dp))
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.12f)),
    )
    Spacer(modifier = Modifier.height(12.dp))
}

@Composable
private fun settingRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector?,
    title: String,
    subtitle: String,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f), modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.width(12.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onBackground)
            Text(text = subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f), maxLines = 1)
        }
        trailing()
    }
    Spacer(modifier = Modifier.height(16.dp))
    Box(
        modifier = Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.surface.copy(alpha = 0.08f)),
    )
    Spacer(modifier = Modifier.height(16.dp))
}

private fun String.capitalize(): String = if (isEmpty()) this else this[0].uppercase() + substring(1)
