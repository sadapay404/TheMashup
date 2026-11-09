package app.themashup.music.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import android.util.Log

/**
 * Keystore-backed storage for the session cookie.
 *
 * Falls back to a plain preference file if the device's Keystore is unavailable (some emulators and
 * heavily-modified ROMs). A degraded-but-working sign-in beats a crash, and the app tells the user in
 * Diagnostics when the fallback is active.
 */
class SecureStore(private val context: Context) {

    private val prefs: SharedPreferences by lazy {
        try {
            val key = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            // Signature fixed by the pinned dependency (androidx.security:security-crypto:1.1.0-alpha06).
            // An earlier version of this file tried to support both the 1.0 and 1.1 signatures by
            // reflection and got the legacy argument order wrong — which is exactly the kind of
            // cleverness that does not survive a compiler.
            EncryptedSharedPreferences.create(
                context,
                "mashup_secure",
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            // A keystore can be genuinely unusable (emulator images, some ROMs, a corrupted key).
            // Degrading keeps sign-in working; Diagnostics reports which store is in use.
            Log.w(TAG, "encrypted store unavailable, using private prefs", t)
            context.getSharedPreferences("mashup_secure_fallback", Context.MODE_PRIVATE)
        }
    }

    fun cookie(): String? = prefs.getString(KEY_COOKIE, null)
    fun putCookie(value: String) = prefs.edit().putString(KEY_COOKIE, value).apply()
    fun visitorData(): String? = prefs.getString(KEY_VISITOR, null)
    fun putVisitorData(value: String) = prefs.edit().putString(KEY_VISITOR, value).apply()
    fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val TAG = "MashupSecure"
        const val KEY_COOKIE = "cookie"
        const val KEY_VISITOR = "visitor"
    }
}
