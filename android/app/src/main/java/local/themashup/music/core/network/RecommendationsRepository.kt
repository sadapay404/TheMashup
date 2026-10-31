package local.themashup.music.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import local.themashup.music.core.domain.Track
import kotlin.coroutines.coroutineContext

data class RecommendationsState(
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val shelves: List<MusicHomeShelf> = emptyList(),
    val error: String? = null,
)

/** In-memory, account-scoped cache so switching tabs does not refetch the entire Home feed. */
class RecommendationsRepository(
    private val scope: CoroutineScope,
    private val client: YouTubeMusicHome = YouTubeMusicHome(),
) {
    private val _state = MutableStateFlow(RecommendationsState())
    val state: StateFlow<RecommendationsState> = _state.asStateFlow()
    private var accountCookie: String? = null // memory only; never written or logged
    private val collections = mutableMapOf<String, List<Track>>()
    private var loadJob: Job? = null
    private var generation = 0L

    @Synchronized
    fun matches(cookie: String): Boolean = accountCookie == cookie

    @Synchronized
    fun show(cookie: String, force: Boolean = false) {
        val changed = cookie != accountCookie
        if (!changed && !force && (_state.value.loading || _state.value.loaded)) return
        generation++
        val request = generation
        loadJob?.cancel()
        if (changed) collections.clear()
        accountCookie = cookie
        if (cookie.isBlank()) {
            _state.value = RecommendationsState()
            return
        }
        _state.value = RecommendationsState(loading = true)
        loadJob = scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { client.load(cookie) } }
            coroutineContext.ensureActive()
            synchronized(this@RecommendationsRepository) {
                if (request == generation) {
                    _state.value = RecommendationsState(
                        loading = false,
                        loaded = result.isSuccess,
                        shelves = result.getOrDefault(emptyList()),
                        error = result.exceptionOrNull()?.message,
                    )
                }
            }
        }
    }

    suspend fun collection(cookie: String, browseId: String): List<Track> {
        synchronized(this) {
            if (accountCookie == cookie) collections[browseId]?.let { return it }
        }
        val tracks = withContext(Dispatchers.IO) { client.loadCollection(cookie, browseId) }
        coroutineContext.ensureActive()
        synchronized(this) {
            // Never retain one account's collection in another account's cache.
            if (accountCookie == cookie) collections[browseId] = tracks
        }
        return tracks
    }
}
