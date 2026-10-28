package local.themashup.music

import android.app.Application

/**
 * Application root. Phase N2 installs the manual DI container (AppContainer:
 * Room, repositories, players) here — kept empty-but-present so the scaffold
 * builds and future wiring has a stable home.
 */
class TheMashupApp : Application()
