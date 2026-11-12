## TheMashup — Android build

Two APKs are attached. **They are not interchangeable** — please read one line before installing.

### `app-withNativeExtractor-release.apk` — **install this one**

This is the build that can play a whole song. It contains a native stream resolver
(NewPipeExtractor + the client handshake that mints YouTube's stream tokens), which is what stops
audio dying a third of the way in.

**Licence:** GPL-3.0. That is a consequence of the resolver library, not a choice — see ADR-005 in
`docs/00a-DECISIONS-LOG.md`.

### `app-standard-release.apk` — licence-clean fallback

No GPL code. It resolves streams from the browser side, which works only when YouTube happens to be
serving a client that does not demand a stream token. When it cannot, it now says so in one sentence
instead of spinning.

### Install

1. Download the APK on the phone (the link works without a GitHub account).
2. Open it; allow installing from this source when Android asks.
3. If an older TheMashup is installed, Android will offer to update it — same package, same key.

If playback still fails, Settings → Diagnostics → *Copy full report* contains the build number, which
resolver rung answered, and the exact HTTP status at the moment audio stopped.
