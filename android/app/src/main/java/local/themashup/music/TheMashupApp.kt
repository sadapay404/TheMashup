package local.themashup.music

import android.app.Application
import local.themashup.music.core.data.AppContainer

/**
 * Application root — constructs the manual DI container (repositories +
 * DataStore +, in later phases, the playback service and download executor)
 * exactly once and hydrates persisted state before any UI reads it.
 */
class TheMashupApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.start()
    }
}
