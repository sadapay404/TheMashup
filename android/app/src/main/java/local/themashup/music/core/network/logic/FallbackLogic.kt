package local.themashup.music.core.network.logic

/**
 * Mirror-pool rotation + source priority — ports of the resolver's
 * `InstancePool` (base.py) and SOURCE_PRIORITY policy. Pure & synchronous:
 * the same rules run in-sandbox and on-device.
 */
class InstancePool(
    instances: List<String>,
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val cooldownMs: Long = DEFAULT_COOLDOWN_MS,
) {
    private val instances: List<String> = instances.map { it.trimEnd('/') }
    private val downUntil = linkedMapOf<String, Long>()

    /** Marks an instance cooling-off for [cooldownMs] (resolver: 45s). */
    fun markDown(instance: String, cooldownMs: Long = this.cooldownMs) {
        downUntil[instance.trimEnd('/')] = nowMs() + cooldownMs
    }

    /** Healthy instances first; everything cooling off → retry all (resolver). */
    fun ordered(): List<String> {
        val now = nowMs()
        val fresh = instances.filter { (downUntil[it] ?: 0L) < now }
        return fresh.ifEmpty { instances }
    }

    val all: List<String> get() = instances

    companion object {
        const val DEFAULT_COOLDOWN_MS = 45_000L
    }
}

/**
 * Source priority for the native app: NewPipe extractor is the direct-YouTube
 * primary (the in-process analog of the resolver's `ytdlp`), Piped second,
 * Invidious last — "engage only when the primary fails" per resolver config.
 */
/** Default mirror pools — verbatim from resolver `config.py` env defaults. */
object FallbackHosts {
    val PIPED: List<String> = listOf(
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.adminforge.de",
        "https://api.piped.yt",
    )
    val INVIDIOUS: List<String> = listOf(
        "https://inv.nadeko.net",
        "https://yewtu.be",
        "https://invidious.nerdvpn.de",
    )
    const val REQUEST_TIMEOUT_SECONDS = 8L
}

object SourcePriority {
    val NATIVE: List<String> = listOf("newpipe", "piped", "invidious")

    /** Resolver shared constant (kept for parity tests). */
    val RESOLVER: List<String> = listOf("ytdlp", "piped", "invidious")
}
