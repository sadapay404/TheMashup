package local.themashup.music.ui.logic

/**
 * Pure theme catalog — port of `packages/shared/src/constants.ts` (THEME_IDS,
 * DEFAULT_THEME) + `ThemeSwitcher.tsx` THEME_META (labels, swatches, hints).
 * Kept free of Compose imports so the sandbox can execute its tests
 * (`scripts/test-kotlin-domain.sh`).
 */
enum class ThemeId(
    val storageKey: String,
    val label: String,
    val hint: String,
    /** [bg, accent, accent-2] swatch colors (web THEME_META), 0xAARRGGBB. */
    val swatch: List<Long>,
    /** Paper & Ink / Vinyl use the serif display font (web --font-display). */
    val serif: Boolean,
) {
    FROSTED(
        storageKey = "frosted",
        label = "Frosted Glass",
        hint = "dark · glass",
        swatch = listOf(0xFF0A0A0FL, 0xFF8B6CFFL, 0xFF4DD0FFL),
        serif = false,
    ),
    PAPER_INK(
        storageKey = "paper-ink",
        label = "Paper & Ink",
        hint = "light · type",
        swatch = listOf(0xFFF4EFE4L, 0xFFB3441FL, 0xFF211C14L),
        serif = true,
    ),
    NEON(
        storageKey = "neon",
        label = "Neon Cyber",
        hint = "dark · glow",
        swatch = listOf(0xFF04060BL, 0xFF00FFC8L, 0xFFFF3EC8L),
        serif = false,
    ),
    AURORA(
        storageKey = "aurora",
        label = "Aurora",
        hint = "dark · mesh",
        swatch = listOf(0xFF0A1022L, 0xFF6EE7FFL, 0xFFB490FFL),
        serif = false,
    ),
    VINYL(
        storageKey = "vinyl",
        label = "Vinyl",
        hint = "warm · retro",
        swatch = listOf(0xFF16110DL, 0xFFE8A33DL, 0xFFA03B3BL),
        serif = true,
    ),
    ;

    val isLight: Boolean get() = this == PAPER_INK
}

/** Switcher order — verbatim THEME_IDS. */
val THEME_CATALOG: List<ThemeId> = listOf(
    ThemeId.FROSTED,
    ThemeId.PAPER_INK,
    ThemeId.NEON,
    ThemeId.AURORA,
    ThemeId.VINYL,
)

/** Web DEFAULT_THEME. */
val DEFAULT_THEME_ID: ThemeId = ThemeId.FROSTED

/** Unknown/prefab keys (old installs, hand-edited prefs) → default, never crash. */
fun themeFromKey(key: String?): ThemeId =
    THEME_CATALOG.firstOrNull { it.storageKey == key } ?: DEFAULT_THEME_ID
