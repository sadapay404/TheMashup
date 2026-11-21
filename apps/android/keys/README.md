# The release signing key

`themashup.p12` is the key every release APK is signed with.

## Why it is committed

Each CI runner used to generate its own debug key, so **every build had a different signature** and
Android refused to install one over the previous ("App not installed", with no explanation). The only
way to update was to uninstall first — losing the download list and every setting — on every single
release.

A committed key ends that. Builds install over each other, and the app's data survives an update.

## Is this safe?

For this app, yes:

- it is open source and distributed only as a GitHub release — there is no Play Store listing and no
  store identity to protect;
- anybody can already rebuild the APK from this repository, so the key grants nobody a capability
  they did not have;
- Android's app signing is not a security boundary between the user and themselves — it stops *other*
  applications from shipping an update over this one, and it still does.

**What it must never become:** a key used for a store listing, a paid app, or anything where an
attacker compiling a modified APK would harm users. If this project ever needs that, generate a new
key, keep it in CI secrets, and rotate `versionCode` past this one.

## Details

| | |
|---|---|
| file | `keys/themashup.p12` (PKCS#12) |
| alias | `themashup` |
| store/key password | `themashup123` |
| valid until | 2054-04-08 |
| SHA-256 | `89:6A:A1:48:21:5C:BA:09:CF:E1:77:A9:72:DD:A1:25:C9:C4:FC:E2:5B:EF:9B:AE:AA:1E:12:49:38:5A:82:D5` |

Override any of it with `MASHUP_KEYSTORE_PATH`, `MASHUP_KEYSTORE_PASSWORD`, `MASHUP_KEY_ALIAS`,
`MASHUP_KEY_PASSWORD` — the environment always wins, so a properly secret key can be dropped in
without editing the build file.
