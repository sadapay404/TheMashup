#!/usr/bin/env bash
# Compile + run the pure-Kotlin domain tests WITHOUT Gradle/Android — the
# authoring sandbox has no JVM, so we fetch (gitignored, tools/):
#   1) JDK 21 via jdk4py PyPI wheel (files.pythonhosted.org)
#   2) Kotlin compiler 2.4.21 via npm tarball (registry.npmjs.org)
# (GitHub release assets redirect off-allowlist — those hosts are blocked.)
# then kotlinc-compile domain + tests + sandbox stubs and run the reflective
# runner. Gradle users: `./gradlew test` runs the SAME test classes against
# real JUnit instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
JDK_HOME="$TOOLS/jdk"
KOTLINC="$TOOLS/kotlinc"
OUT_JAR="$TOOLS/domain-tests.jar"
KOTLIN_VERSION="2.4.21"

log() { printf '[kt-test] %s\n' "$*"; }

ensure_jdk() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    JdkBin="$JAVA_HOME"
    return
  fi
  local venv="$TOOLS/venv"
  if [ ! -x "$venv/bin/python" ]; then
    log "bootstrapping Python venv for jdk4py (one-time)..."
    python3 -m venv "$venv"
  fi
  if ! "$venv/bin/python" -c "import jdk4py" >/dev/null 2>&1; then
    log "downloading jdk4py (JDK 21 inside a PyPI wheel, one-time)..."
    "$venv/bin/pip" install -q "jdk4py==21.0.8.2"
  fi
  JdkHome="$("$venv/bin/python" -c "import jdk4py; print(jdk4py.JAVA_HOME)")"
  [ -x "$JdkHome/bin/java" ] || { echo "jdk4py java not found"; exit 1; }
  JAVA_HOME="$JdkHome"
  export JAVA_HOME
  log "jdk ready: $("$JdkHome/bin/java" -version 2>&1 | head -1)"
}

ensure_kotlinc() {
  if [ -x "$KOTLINC/bin/kotlinc" ]; then return; fi
  log "downloading kotlin-compiler $KOTLIN_VERSION from npm (one-time)..."
  mkdir -p "$TOOLS"
  curl -sSL --retry 4 --retry-delay 1 --max-time 600 \
    -o "$TOOLS/kotlin-compiler.tgz" \
    "https://registry.npmjs.org/kotlin-compiler/-/kotlin-compiler-${KOTLIN_VERSION}.tgz"
  rm -rf "$TOOLS/kotlin-extract"; mkdir -p "$TOOLS/kotlin-extract"
  tar -xzf "$TOOLS/kotlin-compiler.tgz" -C "$TOOLS/kotlin-extract"
  rm -rf "$KOTLINC"
  mv "$TOOLS/kotlin-extract/package" "$KOTLINC"
  rm -rf "$TOOLS/kotlin-extract" "$TOOLS/kotlin-compiler.tgz"
  chmod +x "$KOTLINC/bin/"* 2>/dev/null || true
  log "kotlinc ready: $("$KOTLINC/bin/kotlinc" -version 2>&1 | head -1)"
}

ensure_jdk
ensure_kotlinc

export PATH="$JAVA_HOME/bin:$PATH"

DOMAIN="$ROOT/android/app/src/main/java/local/themashup/music/core/domain"
TESTS="$ROOT/android/app/src/test/java/local/themashup/music/core/domain"
# N3 pure-logic layer (network clients + JSON parsing stay Gradle-only)
NETWORK_LOGIC="$ROOT/android/app/src/main/java/local/themashup/music/core/network/logic"
# N4 pure player core (engine/service shells stay Gradle-only)
PLAYER="$ROOT/android/app/src/main/java/local/themashup/music/core/player"
PLAYER_TESTS="$ROOT/android/app/src/test/java/local/themashup/music/core/player"
NETWORK_TESTS="$ROOT/android/app/src/test/java/local/themashup/music/core/network/logic"
SANDBOX="$ROOT/android/sandbox"

log "compiling domain + tests + sandbox stubs..."
rm -f "$OUT_JAR"
"$KOTLINC/bin/kotlinc" \
  "$DOMAIN"/*.kt \
  "$TESTS"/*.kt \
  "$NETWORK_LOGIC"/*.kt \
  "$NETWORK_TESTS"/*.kt \
  "$PLAYER"/StreamFailover.kt \
  "$PLAYER"/PlaybackStateMachine.kt \
  "$PLAYER_TESTS"/*.kt \
  "$SANDBOX"/*.kt \
  "$SANDBOX"/org/junit/*.kt \
  "$SANDBOX"/kotlinx/serialization/*.kt \
  -include-runtime -d "$OUT_JAR" 2>&1 | grep -v "^warning:" || true

# kotlinc warnings are fine; errors abort via the grep+set -e interplay below
if [ ! -f "$OUT_JAR" ]; then echo "compile produced no jar"; exit 1; fi

log "running..."
"$JAVA_HOME/bin/java" -jar "$OUT_JAR" \
  local.themashup.music.core.domain.FuzzyTest \
  local.themashup.music.core.domain.FormatTest \
  local.themashup.music.core.domain.QualityTest \
  local.themashup.music.core.domain.PlaybackLogicTest \
  local.themashup.music.core.domain.QueueLogicTest \
  local.themashup.music.core.domain.RankTest \
  local.themashup.music.core.domain.HybridTest \
  local.themashup.music.core.domain.RecommendTest \
  local.themashup.music.core.domain.RadioTest \
  local.themashup.music.core.network.logic.VideoIdsTest \
  local.themashup.music.core.network.logic.TrackNormalizeTest \
  local.themashup.music.core.network.logic.StreamNormalizeTest \
  local.themashup.music.core.network.logic.LyricsLogicTest \
  local.themashup.music.core.network.logic.ExtractionLogicTest \
  local.themashup.music.core.player.StreamFailoverTest \
  local.themashup.music.core.player.PlaybackStateMachineTest
