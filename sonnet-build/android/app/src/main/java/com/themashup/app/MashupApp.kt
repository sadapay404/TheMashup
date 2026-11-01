package com.themashup.app

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Process-wide singletons (no DI framework needed). */
object Graph {
    lateinit var scope: CoroutineScope
    lateinit var prefs: Prefs
    lateinit var library: LibraryStore
    lateinit var player: PlayerController
    lateinit var downloads: DownloadCenter

    fun init(app: Context) {
        if (::scope.isInitialized) return
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        prefs = Prefs(app)
        library = LibraryStore(app, scope)
        downloads = DownloadCenter(app, scope)
        player = PlayerController(app, scope)
    }
}

class MashupApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(applicationContext)
    }
}
