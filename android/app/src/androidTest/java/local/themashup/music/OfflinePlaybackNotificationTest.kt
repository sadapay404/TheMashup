package local.themashup.music

import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.CancellationException
import kotlinx.coroutines.runBlocking
import local.themashup.music.core.domain.DownloadJob
import local.themashup.music.core.domain.Track
import local.themashup.music.core.download.MediaStoreWriter
import local.themashup.music.core.player.PlayStatus
import local.themashup.music.core.player.asDownloadedTrack
import org.junit.Assert
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device regression for storage recovery -> offline playback -> system controls.
 * This creates short silent audio files; it does not require a network connection.
 * Run after building on both a pre-Q and a Q+ Android device/emulator.
 */
@RunWith(AndroidJUnit4::class)
class OfflinePlaybackNotificationTest {
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync { block() }

    @Test
    fun legacyDownloadPlaysAndNotificationNextAdvancesQueue() {
        val app = ApplicationProvider.getApplicationContext<TheMashupApp>()
        val engine = app.container.player
        val repository = app.container.downloads
        val locations = mutableListOf<MediaStoreWriter.Saved>()
        val jobs = mutableListOf<DownloadJob>()
        val source = File(app.cacheDir, "offline-playback-test-${UUID.randomUUID()}.wav")
        source.writeBytes(silentWave(seconds = 25))
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            runBlocking {
                repository.awaitLoaded()
                repeat(2) { index ->
                    val id = "test-${UUID.randomUUID()}"
                    val track = Track(id = id, externalId = id, title = "Offline $index", artistNames = "Test artist")
                    val saved = MediaStoreWriter.save(app, source, "$id.wav", "audio/wav")
                    locations += saved
                    val job = repository.enqueue(track, "320k", "mp3")
                    // A missing URI simulates a job written by the previous APK.
                    repository.markCompleted(job.id, saved.displayName, source.length(), location = null)
                    jobs += repository.job(job.id)!!
                }
            }
            main {
                engine.clearQueue()
                engine.playNow(jobs[0].asDownloadedTrack()!!, context = "downloads")
                engine.addToEnd(jobs[1].asDownloadedTrack()!!)
            }
            val playing = engine.awaitState(20_000) { it.status == PlayStatus.PLAYING && it.current?.id == jobs[0].videoId }
            Assert.assertEquals("offline file should play: ${playing.error}", PlayStatus.PLAYING, playing.status)
            Assert.assertEquals("download", playing.source)
            Assert.assertNotNull("legacy location should be remembered", repository.job(jobs[0].id)?.location)
            val initialPosition = playing.positionMs
            scenario.moveToState(Lifecycle.State.CREATED) // background the activity
            val background = engine.awaitState(10_000) {
                it.status == PlayStatus.PLAYING && it.positionMs > initialPosition
            }
            Assert.assertTrue("playback should continue in the background", background.positionMs > initialPosition)

            val manager = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val deadline = SystemClock.elapsedRealtime() + 10_000
            var notification: android.app.Notification? = null
            while (SystemClock.elapsedRealtime() < deadline && notification == null) {
                notification = manager.activeNotifications.firstOrNull { it.id == 1001 }?.notification
                if (notification == null) SystemClock.sleep(100)
            }
            Assert.assertNotNull("playback notification should be posted", notification)
            Assert.assertEquals("themashup_playback", notification!!.channelId)
            val actions = requireNotNull(notification.actions) { "playback notification has no actions" }
            Assert.assertTrue("previous, pause and next actions should be present", actions.size >= 3)
            val toggle = requireNotNull(actions[1].actionIntent)
            toggle.send()
            val paused = engine.awaitState(10_000) { it.status == PlayStatus.PAUSED }
            Assert.assertEquals("notification pause should pause playback", PlayStatus.PAUSED, paused.status)
            // Media3 changes the paused-state action to a foreground-service
            // PendingIntent; use the refreshed notification, as the user does.
            val playDeadline = SystemClock.elapsedRealtime() + 10_000
            var playAction: android.app.PendingIntent? = null
            while (SystemClock.elapsedRealtime() < playDeadline && playAction == null) {
                val candidate = manager.activeNotifications.firstOrNull { it.id == 1001 }
                    ?.notification?.actions?.getOrNull(1)?.actionIntent
                if (candidate != null && candidate != toggle) playAction = candidate
                if (playAction == null) SystemClock.sleep(100)
            }
            Assert.assertNotNull("paused notification should offer Play", playAction)
            playAction!!.send()
            val resumed = engine.awaitState(10_000) { it.status == PlayStatus.PLAYING }
            Assert.assertEquals("notification play should resume playback", PlayStatus.PLAYING, resumed.status)
            requireNotNull(actions.last().actionIntent).send()
            val next = engine.awaitState(20_000) { it.status == PlayStatus.PLAYING && it.current?.id == jobs[1].videoId }
            Assert.assertEquals("next notification action should use the app queue", jobs[1].videoId, next.current?.id)
            Assert.assertEquals("download", next.source)
            requireNotNull(actions.first().actionIntent).send()
            val previous = engine.awaitState(20_000) { it.status == PlayStatus.PLAYING && it.current?.id == jobs[0].videoId }
            Assert.assertEquals("previous notification action should use the app queue", jobs[0].videoId, previous.current?.id)
        } finally {
            main { engine.clearQueue() }
            runBlocking { jobs.forEach { repository.remove(it.id) } }
            locations.forEach { saved ->
                if (saved.location.startsWith("content://")) app.contentResolver.delete(Uri.parse(saved.location), null, null)
                else File(saved.location).delete()
            }
            source.delete()
            scenario.close()
        }
    }

    @Test
    fun cancelledSaveDoesNotLeaveAPartialDownload() {
        val app = ApplicationProvider.getApplicationContext<TheMashupApp>()
        val name = "cancel-test-${UUID.randomUUID()}.wav"
        val source = File(app.cacheDir, name).apply { writeBytes(silentWave(seconds = 1)) }
        try {
            var checks = 0
            try {
                MediaStoreWriter.save(app, source, name, "audio/wav") {
                    if (++checks == 2) throw CancellationException("cancel test")
                }
                Assert.fail("save should have been cancelled")
            } catch (_: CancellationException) {
                // The second check occurs after creation, during copy.
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val cursor = app.contentResolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Downloads._ID),
                    "${MediaStore.Downloads.DISPLAY_NAME}=? AND ${MediaStore.Downloads.RELATIVE_PATH}=?",
                    arrayOf(name, "${Environment.DIRECTORY_DOWNLOADS}/TheMashup/"),
                    null,
                )
                Assert.assertNotNull("could not query Downloads", cursor)
                cursor!!.use { Assert.assertEquals("partial MediaStore item should be deleted", 0, it.count) }
            } else {
                val job = DownloadJob(id = "cancel", videoId = "test", title = "test", container = "mp3", quality = "320k", filename = name)
                Assert.assertNull(MediaStoreWriter.findExisting(app, job))
            }
        } finally {
            source.delete()
        }
    }

    private fun silentWave(seconds: Int): ByteArray {
        val sampleRate = 8_000
        val dataSize = sampleRate * seconds * 2
        return ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(36 + dataSize)
            put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1.toShort()) // PCM
            putShort(1.toShort()) // mono
            putInt(sampleRate)
            putInt(sampleRate * 2)
            putShort(2.toShort())
            putShort(16.toShort())
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(dataSize)
        }.array()
    }
}
