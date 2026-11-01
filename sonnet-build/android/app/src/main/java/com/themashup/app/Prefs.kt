package com.themashup.app

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.store: DataStore<Preferences> by preferencesDataStore(name = "mashup_settings")

data class Settings(
    val theme: String = "frosted",
    val crossfade: Int = 3,
    val gapless: Boolean = true,
    val normalize: Boolean = false,
    val normStrength: Int = 50,
    val rate: Float = 1f,
    val eq: String = "flat",
    val volume: Float = 0.9f,
    val repeat: Repeat = Repeat.OFF,
    val shuffle: Boolean = false,
    val cookie: String = "",
    val accountName: String = "",
)

val EqPresets = listOf("off", "flat", "bass-boost", "vocal", "treble", "rock", "electronic")

class Prefs(private val ctx: Context) {
    private object K {
        val theme = stringPreferencesKey("theme")
        val crossfade = intPreferencesKey("crossfade")
        val gapless = booleanPreferencesKey("gapless")
        val normalize = booleanPreferencesKey("normalize")
        val normStrength = intPreferencesKey("normStrength")
        val rate = floatPreferencesKey("rate")
        val eq = stringPreferencesKey("eq")
        val volume = floatPreferencesKey("volume")
        val repeat = stringPreferencesKey("repeat")
        val shuffle = booleanPreferencesKey("shuffle")
        val cookie = stringPreferencesKey("cookie")
        val accountName = stringPreferencesKey("accountName")
    }

    val settings: Flow<Settings> = ctx.store.data.map { p ->
        val d = Settings()
        Settings(
            theme = p[K.theme] ?: d.theme,
            crossfade = p[K.crossfade] ?: d.crossfade,
            gapless = p[K.gapless] ?: d.gapless,
            normalize = p[K.normalize] ?: d.normalize,
            normStrength = p[K.normStrength] ?: d.normStrength,
            rate = p[K.rate] ?: d.rate,
            eq = p[K.eq] ?: d.eq,
            volume = p[K.volume] ?: d.volume,
            repeat = runCatching { Repeat.valueOf(p[K.repeat] ?: "OFF") }.getOrDefault(Repeat.OFF),
            shuffle = p[K.shuffle] ?: d.shuffle,
            cookie = p[K.cookie] ?: "",
            accountName = p[K.accountName] ?: "",
        )
    }

    suspend fun setTheme(v: String) = ctx.store.edit { it[K.theme] = v }
    suspend fun setCrossfade(v: Int) = ctx.store.edit { it[K.crossfade] = v }
    suspend fun setGapless(v: Boolean) = ctx.store.edit { it[K.gapless] = v }
    suspend fun setNormalize(v: Boolean) = ctx.store.edit { it[K.normalize] = v }
    suspend fun setNormStrength(v: Int) = ctx.store.edit { it[K.normStrength] = v }
    suspend fun setRate(v: Float) = ctx.store.edit { it[K.rate] = v }
    suspend fun setEq(v: String) = ctx.store.edit { it[K.eq] = v }
    suspend fun setVolume(v: Float) = ctx.store.edit { it[K.volume] = v }
    suspend fun setRepeat(v: Repeat) = ctx.store.edit { it[K.repeat] = v.name }
    suspend fun setShuffle(v: Boolean) = ctx.store.edit { it[K.shuffle] = v }
    suspend fun setAccount(cookie: String, name: String) = ctx.store.edit {
        it[K.cookie] = cookie
        it[K.accountName] = name
    }
}
