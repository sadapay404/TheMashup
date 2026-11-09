package app.themashup.music.diagnostics

import android.content.Context
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Crash and log capture that works without a cable.
 *
 * Why this exists: "it crashes on open" is unfixable from a description alone. `adb logcat` is the
 * normal answer, but it needs a computer, a cable and developer options, and the person reporting the
 * crash may have none of those. So the app records its own failures and hands them back inside the
 * app, to be copied out and pasted.
 *
 * Two mechanisms, because a crash and a bug are different problems:
 *
 *  1. `Thread.setDefaultUncaughtExceptionHandler` — writes the fatal stack trace to a file *before*
 *     the process dies. The next launch reads it. This is the only thing that survives a hard crash;
 *     nothing in the dying process can render UI at that point.
 *  2. `logcat -d --pid <our pid>` — the last N lines for this process only. Since Android 4.1 an app
 *     can read its own logs without READ_LOGS, so this needs no permission prompt.
 *
 * Both are bounded. A log capture that can grow without limit is a storage leak that only appears on
 * the device of the one user who leaves the app open for a week.
 */
@CapacitorPlugin(name = "MashupLog")
class LogPlugin : Plugin() {

    @PluginMethod
    fun crashes(call: PluginCall) {
        val file = File(getContext().filesDir, CRASH_FILE)
        if (!file.isFile) {
            call.resolve(JSObject().put("found", false).put("entries", JSArray()))
            return
        }
        val text = runCatching { file.readText() }.getOrDefault("")
        call.resolve(
            JSObject()
                .put("found", text.isNotBlank())
                .put("text", text)
                .put("bytes", file.length()),
        )
    }

    /**
     * Recent logcat for this process.
     *
     * `--pid` is the whole point: without it the result is every app on the phone, which is both
     * useless and a privacy problem. If the platform refuses the command we say so rather than
     * returning an empty string that looks like "nothing was logged".
     */
    @PluginMethod
    fun logcat(call: PluginCall) {
        val lines = call.getInt("lines") ?: 400
        val result = captureLogcat(lines)
        call.resolve(
            JSObject()
                .put("ok", result.first)
                .put("text", result.second),
        )
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        runCatching { File(getContext().filesDir, CRASH_FILE).delete() }
        call.resolve(JSObject().put("cleared", true))
    }

    /** Marks a point in the log so a report can be tied to a specific build and moment. */
    /**
     * A note from the web layer into the same boot log.
     *
     * Without this the log stops at "boot complete" and says nothing about what the page did next -
     * which is exactly the window where the user reports the screen staying black.
     */
    @PluginMethod
    fun mark(call: PluginCall) {
        val message = call.getString("message") ?: "mark"
        boot("web: $message")
        call.resolve(JSObject().put("ok", true))
    }

    /**
     * Mirror the crash report somewhere a file manager can reach.
     *
     * The report otherwise lives in internal storage, which needs root or adb to read - neither of
     * which is available if the app will not boot. External app storage is readable through the
     * system Files app on every supported Android version without any permission prompt, so a user
     * whose app cannot start can still hand us the reason.
     */
    @PluginMethod
    fun export(call: PluginCall) {
        val ctx = getContext()
        val source = File(ctx.filesDir, CRASH_FILE)
        if (!source.isFile) {
            call.resolve(JSObject().put("exported", false).put("reason", "no crash recorded"))
            return
        }
        val dir = File(ctx.getExternalFilesDir(null), "crash-report")
        val target = File(dir, "last-crash.txt")
        val ok = runCatching {
            dir.mkdirs()
            target.writeText(source.readText())
        }.getOrDefault(false)
        call.resolve(
            JSObject()
                .put("exported", ok)
                .put("path", if (ok) target.absolutePath else "")
                .put("reason", if (ok) "" else "could not write to external storage"),
        )
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val ctx = getContext()
        val pkg = ctx.packageName
        val pm = ctx.packageManager
        val info = runCatching { pm.getPackageInfo(pkg, 0) }.getOrNull()
        call.resolve(
            JSObject()
                .put("package", pkg)
                .put("versionName", info?.versionName ?: "unknown")
                .put("versionCode", if (android.os.Build.VERSION.SDK_INT >= 28) info?.longVersionCode ?: 0L else (info?.versionCode ?: 0).toLong())
                .put("sdk", android.os.Build.VERSION.SDK_INT)
                .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                .put("debuggable", (ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                .put("crashFile", File(ctx.filesDir, CRASH_FILE).absolutePath),
        )
    }

    private fun captureLogcat(lines: Int): Pair<Boolean, String> {
        return try {
            val pid = android.os.Process.myPid().toString()
            val process = Runtime.getRuntime().exec(
                arrayOf("logcat", "-d", "-v", "time", "-t", lines.toString(), "--pid", pid),
            )
            val text = process.inputStream.bufferedReader().use { it.readText() }
            val finished = process.waitFor()
            if (finished == 0) true to text else false to text
        } catch (t: Throwable) {
            Log.w(TAG, "logcat unavailable", t)
            false to ""
        }
    }

    companion object {
        private const val TAG = "MashupLog"
        private const val CRASH_FILE = "last-crash.txt"

        /**
         * Session breadcrumbs.
         *
         * An exception handler cannot see a native kill: low-memory killer, a native abort in the
         * WebView renderer, or the OS stopping the process. Those leave no Java trace and no Android
         * "has stopped" dialog - the app simply vanishes, which is indistinguishable from a crash
         * when reported by a user. The only way to know it happened is to leave a marker behind and
         * notice on the next launch that it was never cleaned up.
         *
         * Two files, both tiny: the current session's stage, and the previous session's fate.
         */
        private const val SESSION_FILE = "session.txt"
        private const val SESSION_END = "ended"

        private fun sessionFile(app: Context) = File(app.filesDir, SESSION_FILE)

        /**
         * Boot log in *external* app storage.
         *
         * This is the one artefact that survives a native crash and can be read by a person holding
         * only the phone: the system Files app can open Android/data/<pkg>/files/ without root, a
         * cable or a permission prompt. Everything else needs the app to reach a screen, which is
         * exactly what a boot crash prevents.
         *
         * Failures to write here are swallowed on purpose - a device with no external storage must
         * not fail to boot because logging failed.
         */
        private var bootLog: File? = null

        fun startBootLog(context: Context) {
            val app = context.applicationContext
            bootLog = runCatching {
                val dir = File(app.getExternalFilesDir(null), "diagnostics").apply { mkdirs() }
                File(dir, "boot-log.txt").apply { writeText("") }
            }.getOrNull()
            boot("process started · ${app.packageName}")
        }

        fun boot(stage: String) {
            Log.i(TAG, "boot: $stage")
            val file = bootLog ?: return
            runCatching {
                val stamp = SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
                file.appendText("$stamp  $stage\n")
            }
        }

        /**
         * Record that a session is starting, and whether the previous one ended cleanly.
         * Called first thing in MainActivity.onCreate.
         */
        fun beginSession(context: Context) {
            val app = context.applicationContext
            try {
                val previous = sessionFile(app).takeIf { it.isFile }?.readText()
                if (previous != null && !previous.startsWith(SESSION_END)) {
                    // No exception was recorded for this exit, so the process was killed rather than
                    // crashed in Java. Say so plainly; guessing a cause here would be dishonest.
                    val report = File(app.filesDir, CRASH_FILE)
                    if (!report.isFile) {
                        report.writeText(
                            buildString {
                                appendLine("=== TheMashup stopped unexpectedly ===")
                                appendLine("time: ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS Z", Locale.US).format(Date())}")
                                appendLine("device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · API ${android.os.Build.VERSION.SDK_INT}")
                                appendLine("package: ${app.packageName}")
                                appendLine()
                                appendLine("No Java exception was recorded, so the process was killed rather than")
                                appendLine("crashing: low-memory killer, a native fault in the WebView, or the OS")
                                appendLine("stopping it. The previous session reached these stages:")
                                appendLine()
                                append(previous)
                                appendLine()
                                appendLine("--- last logcat (this process, previous session not included) ---")
                                appendLine(captureLogcatFor(app, 250))
                            },
                        )
                    }
                }
                sessionFile(app).writeText("stage: activity-created\nstarted: ${System.currentTimeMillis()}\n")
            } catch (t: Throwable) {
                Log.w(TAG, "session marker failed", t)
            }
        }

        /** Note how far the session got, so a later abrupt exit can be located. */
        fun markStage(context: Context, stage: String) {
            try {
                val f = sessionFile(context.applicationContext)
                f.appendText("stage: $stage\n")
            } catch (t: Throwable) {
                Log.w(TAG, "stage marker failed for $stage", t)
            }
        }

        /** Called when the user leaves normally, so the next launch does not report a false crash. */
        fun endSession(context: Context) {
            try {
                sessionFile(context.applicationContext).writeText("$SESSION_END cleanly\n")
            } catch (t: Throwable) {
                Log.w(TAG, "session end failed", t)
            }
        }

        /**
         * Install the fatal-exception handler. Called from MainActivity *before* `super.onCreate`,
         * because the window between process start and Activity creation is exactly where a bad
         * plugin registration would blow up, and a handler installed after that gap misses it.
         */
        fun install(context: Context) {
            val app = context.applicationContext
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, error ->
                try {
                    writeCrash(app, thread, error)
                } catch (_: Throwable) {
                    // Recording the crash must never replace it with a second crash.
                }
                // Hand back so the platform still does its own reporting (and kills the process).
                previous?.uncaughtException(thread, error)
            }
            Log.i(TAG, "crash handler installed")
        }

        private fun writeCrash(app: Context, thread: Thread, error: Throwable) {
            val sw = StringWriter()
            PrintWriter(sw).use { error.printStackTrace(it) }
            val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS Z", Locale.US).format(Date())
            val sequence = captureLogcatFor(app, 250)

            val report = buildString {
                appendLine("=== TheMashup crash ===")
                appendLine("time: $stamp")
                appendLine("thread: ${thread.name}")
                appendLine("device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · API ${android.os.Build.VERSION.SDK_INT}")
                appendLine("package: ${app.packageName}")
                appendLine()
                appendLine(sw.toString())
                appendLine("--- last logcat (this process) ---")
                appendLine(sequence)
            }

            // One file, overwritten. The most recent crash is the one being reported; keeping a
            // history would grow unbounded on a device that crashes in a loop.
            File(app.filesDir, CRASH_FILE).writeText(report.take(200_000))
        }

        /**
         * Log text for the crash file, or an explanation of why there is none.
         *
         * Previously this returned the text in the wrong tuple slot on one path and an empty string on
         * the other, so every crash report shipped to the user was missing the very lines that explain
         * it. The failure case now says so explicitly instead of looking like a quiet log.
         */
        private fun captureLogcatFor(app: Context, lines: Int): String {
            return try {
                val pid = android.os.Process.myPid().toString()
                val p = Runtime.getRuntime().exec(
                    arrayOf("logcat", "-d", "-v", "time", "-t", lines.toString(), "--pid", pid),
                )
                val text = p.inputStream.bufferedReader().use { it.readText() }
                p.waitFor()
                text.ifBlank { "(logcat returned no lines for this process)" }
            } catch (t: Throwable) {
                "(logcat unavailable: ${t.javaClass.simpleName})"
            }
        }
    }
}
