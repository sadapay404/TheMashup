package local.themashup.music.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/**
 * App settings via Preferences DataStore — theme must survive process death
 * (and Android's killing background apps), so it can't be an in-memory state
 * holder. Keys mirror the web user-settings where applicable.
 */
class SettingsRepository(private val context: Context) {

    private object Keys {
        val THEME = stringPreferencesKey("theme")
        val VISUALIZER = booleanPreferencesKey("visualizer_on")
        val AUDIO_QUALITY = stringPreferencesKey("audio_quality")
        val LYRICS_ON = booleanPreferencesKey("lyrics_on")
    }

    val themeKey: Flow<String> = context.settingsDataStore.data.map { it[Keys.THEME] ?: DEFAULT_THEME }
    val visualizerOn: Flow<Boolean> = context.settingsDataStore.data.map { it[Keys.VISUALIZER] ?: true }
    val audioQuality: Flow<String> = context.settingsDataStore.data.map { it[Keys.AUDIO_QUALITY] ?: "320k" }
    val lyricsOn: Flow<Boolean> = context.settingsDataStore.data.map { it[Keys.LYRICS_ON] ?: true }

    suspend fun setThemeKey(key: String) {
        context.settingsDataStore.edit { it[Keys.THEME] = key }
    }

    suspend fun setVisualizerOn(on: Boolean) {
        context.settingsDataStore.edit { it[Keys.VISUALIZER] = on }
    }

    suspend fun setAudioQuality(quality: String) {
        context.settingsDataStore.edit { it[Keys.AUDIO_QUALITY] = quality }
    }

    suspend fun setLyricsOn(on: Boolean) {
        context.settingsDataStore.edit { it[Keys.LYRICS_ON] = on }
    }

    companion object {
        /** Paper & Ink — the default theme's storage key (ui/theme). */
        const val DEFAULT_THEME = "paper"
    }
}
