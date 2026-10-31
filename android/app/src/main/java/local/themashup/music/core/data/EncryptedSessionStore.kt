package local.themashup.music.core.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.IOException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The session is a bearer credential. Keep it encrypted and out of Android backups. */
internal class EncryptedSessionStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "youtube-session"))

    /** Returns the decrypted session, or "" if the file doesn't exist or is unreadable. */
    fun read(): String {
        if (!file.baseFile.exists()) return ""
        val bytes = try { file.readFully() } catch (_: Exception) { return "" }
        if (bytes.size <= IV_BYTES) return ""
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_BYTES)))
            cipher.doFinal(bytes.copyOfRange(IV_BYTES, bytes.size)).toString(Charsets.UTF_8)
        } catch (_: Exception) {
            // Corrupt ciphertext (wrong key, bad decrypt) — signal caller to reset.
            throw SessionCorruptException()
        }
    }

    /** Thrown when the saved ciphertext cannot be decrypted — key material is invalid. */
    internal class SessionCorruptException : Exception()

    fun resetUnreadable() {
        file.delete()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(KEY_ALIAS) }
    }

    fun write(value: String) {
        if (value.isEmpty()) {
            file.delete()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val output = file.startWrite()
        try {
            output.write(encrypted)
            file.finishWrite(output)
        } catch (e: Exception) {
            file.failWrite(output)
            throw e
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
            generateKey()
        }
    }

    private companion object {
        const val KEY_ALIAS = "themashup_youtube_session"
        const val IV_BYTES = 12
    }
}
