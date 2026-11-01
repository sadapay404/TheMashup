package com.themashup.app

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.util.UnstableApi
import com.themashup.app.ui.*

enum class Tab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Search("Search", Icons.Filled.Search),
    Library("Library", Icons.Filled.LibraryMusic),
    Downloads("Downloads", Icons.Filled.Download),
    Settings("Settings", Icons.Filled.Settings),
}

/** Cross-screen UI state. */
class UiState {
    var tab by mutableStateOf(Tab.Home)
    var expanded by mutableStateOf(false)
    var queueOpen by mutableStateOf(false)
    var playlistTarget by mutableStateOf<Track?>(null)
    var searchSeed by mutableStateOf("")
    var toast by mutableStateOf<String?>(null)

    fun search(q: String) {
        searchSeed = q
        tab = Tab.Search
    }
}

@UnstableApi
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Graph.init(applicationContext)
        enableEdgeToEdge()
        setContent {
            val settings by Graph.prefs.settings.collectAsState(initial = Settings())
            MashupTheme(settings.theme) { AppRoot() }
        }
    }
}

@UnstableApi
@Composable
fun AppRoot() {
    val p = LocalPalette.current
    val ui = remember { UiState() }
    val queue by Graph.player.queue.collectAsState()
    val hasTrack = queue.isNotEmpty()

    // Notification permission (Android 13+). Only asks for the permission; never starts a service.
    val askNotif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    BackHandler(enabled = ui.queueOpen || ui.expanded || ui.playlistTarget != null) {
        when {
            ui.playlistTarget != null -> ui.playlistTarget = null
            ui.queueOpen -> ui.queueOpen = false
            else -> ui.expanded = false
        }
    }
    LaunchedEffect(ui.toast) {
        if (ui.toast != null) {
            kotlinx.coroutines.delay(2400)
            ui.toast = null
        }
    }

    Box(Modifier.fillMaxSize().background(p.bg).background(p.backdrop)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Box(Modifier.weight(1f)) {
                when (ui.tab) {
                    Tab.Home -> HomeScreen(ui)
                    Tab.Search -> SearchScreen(ui)
                    Tab.Library -> LibraryScreen(ui)
                    Tab.Downloads -> DownloadsScreen(ui)
                    Tab.Settings -> SettingsScreen(ui)
                }
            }
            if (hasTrack) MiniPlayer(ui)
            NavigationBar(containerColor = p.surface.copy(alpha = 0.96f), contentColor = p.text, tonalElevation = 0.dp) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = ui.tab == t,
                        onClick = { ui.tab = t },
                        icon = { Icon(t.icon, contentDescription = t.label) },
                        label = { Text(t.label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = p.accentText, selectedTextColor = p.accent,
                            indicatorColor = p.accent, unselectedIconColor = p.muted, unselectedTextColor = p.muted,
                        ),
                    )
                }
            }
        }

        AnimatedVisibility(ui.expanded, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
            ExpandedPlayer(ui)
        }

        AnimatedVisibility(ui.queueOpen, enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).clickable { ui.queueOpen = false })
        }
        AnimatedVisibility(
            ui.queueOpen, modifier = Modifier.align(Alignment.CenterEnd),
            enter = slideInHorizontally { it }, exit = slideOutHorizontally { it },
        ) { QueueDrawer(ui) }

        if (ui.playlistTarget != null) PlaylistPicker(ui)

        ui.toast?.let {
            Surface(
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 8.dp),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(50), color = p.raised, contentColor = p.text, shadowElevation = 8.dp,
            ) { Text(it, Modifier.padding(horizontal = 18.dp, vertical = 10.dp), fontSize = 14.sp) }
        }
    }
}
