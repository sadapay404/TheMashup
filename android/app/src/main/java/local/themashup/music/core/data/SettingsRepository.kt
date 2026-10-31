package local.themashup.music.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import androidx.datastore.preferences.core.emptyPreferences

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
        val YT_COOKIE = stringPreferencesKey("yt_cookie")
    }

    val themeKey: Flow<String> = context.settingsDataStore.data
        .catch { _ -> emit(emptyPreferences()) }
        .map { it[Keys.THEME] ?: DEFAULT_THEME }
    val visualizerOn: Flow<Boolean> = context.settingsDataStore.data
        .catch { _ -> emit(emptyPreferences()) }
        .map { it[Keys.VISUALIZER] ?: true }
    val audioQuality: Flow<String> = context.settingsDataStore.data
        .catch { _ -> emit(emptyPreferences()) }
        .map { it[Keys.AUDIO_QUALITY] ?: "320k" }
    val lyricsOn: Flow<Boolean> = context.settingsDataStore.data
        .catch { _ -> emit(emptyPreferences()) }
        .map { it[Keys.LYRICS_ON] ?: true }

    private val sessionStore = EncryptedSessionStore(context)
    private val sessionMutex = Mutex()
    private val sessionReady = CompletableDeferred<Unit>()
    private val cookieState = MutableStateFlow("")
    /** The credential is never included in settings backups or general network requests. */
    val youtubeCookie: StateFlow<String> = cookieState.asStateFlow()

    init {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                sessionMutex.withLock {
                    val legacy = try {
                        context.settingsDataStore.data.first()[Keys.YT_COOKIE].orEmpty()
                    } catch (_: Exception) {
                        // Corrupt DataStore — start fresh, don't crash.
                        ""
                    }
                    var cookie = try {
                        sessionStore.read()
                    } catch (e: EncryptedSessionStore.SessionCorruptException) {
                        // Keystore keys may be invalidated by a device restore/reset.
                        // Remove the unusable ciphertext and let the user reconnect.
                        sessionStore.resetUnreadable()
                        ""
                    } catch (_: Exception) {
                        // Transient read error — keep the legacy cookie if any,
                        // don't destroy the keystore entry.
                        legacy
                    }
                    if (cookie.isEmpty() && legacy.isNotEmpty()) {
                        sessionStore.write(legacy)
                        cookie = legacy
                    }
                    if (legacy.isNotEmpty()) context.settingsDataStore.edit { it.remove(Keys.YT_COOKIE) }
                    cookieState.value = cookie
                }
                sessionReady.complete(Unit)
            } catch (e: Exception) {
                // Never leave sessionReady failed forever — complete with an
                // empty cookie so sign-in can be retried.
                cookieState.value = ""
                sessionReady.complete(Unit)
            }
        }
    }

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

    suspend fun setYoutubeCookie(cookie: String) {
        sessionReady.await()
        withContext(Dispatchers.IO) {
            sessionMutex.withLock {
                sessionStore.write(cookie)
                cookieState.value = cookie
            }
        }
    }

    companion object {
        /** Paper & Ink — the default theme's storage key (ui/theme). */
        /** Web DEFAULT_THEME (packages/shared constants). */
        const val DEFAULT_THEME = "frosted"
    }
}
