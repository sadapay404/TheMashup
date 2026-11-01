package com.themashup.app.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.themashup.app.*
import kotlinx.coroutines.launch

@Composable
private fun SettingRow(title: String, hint: String? = null, content: @Composable RowScope.() -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (hint != null) Text(hint, color = p.muted, fontSize = 12.sp)
        }
        content()
    }
}

@Composable
private fun MSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalPalette.current
    Switch(
        checked = checked, onCheckedChange = onChange,
        colors = SwitchDefaults.colors(checkedThumbColor = p.accentText, checkedTrackColor = p.accent, uncheckedThumbColor = p.muted, uncheckedTrackColor = p.raised, uncheckedBorderColor = p.outline),
    )
}

@Composable
fun SettingsScreen(ui: UiState) {
    val p = LocalPalette.current
    val s by Graph.prefs.settings.collectAsState(initial = Settings())
    val sleepEnd by Graph.player.sleepEnd.collectAsState()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var sleepMenu by remember { mutableStateOf(false) }
    var crossfade by remember(s.crossfade) { mutableFloatStateOf(s.crossfade.toFloat()) }
    var norm by remember(s.normStrength) { mutableFloatStateOf(s.normStrength.toFloat()) }
    var rate by remember(s.rate) { mutableFloatStateOf(s.rate) }
    val signedIn = s.cookie.isNotEmpty()

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp)) {
        item { ScreenTitle("Settings") }

        item { SectionTitle("Appearance") }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(Palettes) { t ->
                    val on = s.theme == t.id
                    val shape = RoundedCornerShape(20.dp)
                    Column(
                        Modifier.width(150.dp).clip(shape).background(t.bg)
                            .border(if (on) 2.dp else 1.dp, if (on) t.accent else t.outline, shape)
                            .clickable { scope.launch { Graph.prefs.setTheme(t.id) } },
                    ) {
                        Box(Modifier.fillMaxWidth().height(78.dp).background(t.surface)) {
                            Box(Modifier.padding(12.dp).width(60.dp).height(10.dp).clip(CircleShape).background(t.text.copy(alpha = 0.8f)))
                            Box(Modifier.padding(start = 12.dp, top = 30.dp).width(38.dp).height(7.dp).clip(CircleShape).background(t.muted))
                            Row(Modifier.align(Alignment.BottomStart).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(Modifier.size(20.dp).clip(CircleShape).background(t.accent))
                                Box(Modifier.size(20.dp).clip(CircleShape).background(t.accent2))
                                Box(Modifier.size(20.dp).clip(CircleShape).background(t.raised).border(1.dp, t.outline, CircleShape))
                            }
                            if (on) Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(24.dp).clip(CircleShape).background(t.accent), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.Check, null, tint = t.accentText, modifier = Modifier.size(16.dp))
                            }
                        }
                        Column(Modifier.padding(12.dp)) {
                            Text(t.name, color = t.text, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(t.tagline, color = t.muted, fontSize = 11.sp)
                        }
                    }
                }
            }
        }

        item { SectionTitle("Playback") }
        item {
            GlassCard(Modifier.fillMaxWidth()) {
                SettingRow("Gapless playback", "Pre-buffers the next track.") { MSwitch(s.gapless) { v -> scope.launch { Graph.prefs.setGapless(v) } } }
                SettingRow("Crossfade · ${if (crossfade.toInt() == 0) "off" else "${crossfade.toInt()}s"}", "Fade out / fade in between tracks.") {}
                Slider(crossfade, { crossfade = it }, Modifier.padding(horizontal = 16.dp), valueRange = 0f..12f, steps = 11, colors = mSliderColors(), onValueChangeFinished = { scope.launch { Graph.prefs.setCrossfade(crossfade.toInt()) } })
                SettingRow("Playback speed · ${"%.2f".format(rate)}×") {}
                Slider(rate, { rate = it }, Modifier.padding(horizontal = 16.dp), valueRange = 0.5f..2f, steps = 5, colors = mSliderColors(), onValueChangeFinished = { scope.launch { Graph.prefs.setRate(rate) } })
                SettingRow("Loudness normalization", "Evens out volume between tracks.") { MSwitch(s.normalize) { v -> scope.launch { Graph.prefs.setNormalize(v) } } }
                if (s.normalize) {
                    SettingRow("Strength · ${norm.toInt()}%") {}
                    Slider(norm, { norm = it }, Modifier.padding(horizontal = 16.dp), valueRange = 0f..100f, colors = mSliderColors(), onValueChangeFinished = { scope.launch { Graph.prefs.setNormStrength(norm.toInt()) } })
                }
                SettingRow("Equalizer preset", "Saved as state; no native audio-effect binding.") {}
                LazyRow(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(EqPresets) { e -> MChip(e.replace("-", " "), s.eq == e) { scope.launch { Graph.prefs.setEq(e) } } }
                }
                SettingRow("Sleep timer", sleepEnd?.let { "Pausing in about ${((it - System.currentTimeMillis()) / 60000 + 1).coerceAtLeast(1)} min" } ?: "Pause playback after a set time.") {
                    Box {
                        OutlineButton(if (sleepEnd != null) "Running" else "Off") { sleepMenu = true }
                        DropdownMenu(expanded = sleepMenu, onDismissRequest = { sleepMenu = false }, containerColor = p.raised) {
                            listOf(0, 5, 10, 15, 30, 45, 60, 90).forEach { m ->
                                DropdownMenuItem(
                                    text = { Text(if (m == 0) "Off" else "$m min", color = p.text) },
                                    onClick = { sleepMenu = false; Graph.player.setSleepTimer(m); ui.toast = if (m == 0) "Sleep timer off" else "Sleep timer: $m min" },
                                )
                            }
                        }
                    }
                }
            }
        }

        item { SectionTitle("Account") }
        item {
            GlassCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    if (signedIn) {
                        Text("Signed in to YouTube Music", color = p.text, fontWeight = FontWeight.SemiBold)
                        Text("${s.accountName.ifEmpty { "Session saved" }} · home shows recommendation shelves.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp))
                        Spacer(Modifier.height(8.dp))
                        OutlineButton("Sign out") {
                            scope.launch { Graph.prefs.setAccount("", "") }
                            android.webkit.CookieManager.getInstance().removeAllCookies(null)
                            ui.toast = "Signed out"
                        }
                    } else {
                        Text("Sign in to YouTube Music", color = p.text, fontWeight = FontWeight.SemiBold)
                        Text("Opens Google sign-in in a secure WebView, captures the music.youtube.com session and verifies it.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp))
                        Spacer(Modifier.height(8.dp))
                        PrimaryButton("Sign in") { ctx.startActivity(Intent(ctx, SignInActivity::class.java)) }
                    }
                }
            }
        }

        item { SectionTitle("About") }
        item {
            GlassCard(Modifier.fillMaxWidth()) {
                Text("TheMashup 1.0 — local-first player for public catalog sources, local files and offline downloads.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}
