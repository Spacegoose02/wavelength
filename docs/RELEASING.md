# Releasing

## Versioning

- Semantic-ish: `MAJOR.MINOR.PATCH`. Bump **MINOR** for features, **PATCH** for fixes.
- The version lives in **two places** — keep them equal:
  - `src-tauri/tauri.conf.json` → `"version"` (drives the installer name and Android `versionCode`)
  - `package.json` → `"version"`
- Android `versionCode` is derived from it (`0.4.1` → `4001`). It must always go **up**, or the APK
  won't install as an update.

## Automated builds (GitHub Actions)

`.github/workflows/release.yml` builds and attaches the binaries whenever a release is **published**
on GitHub, so creating the release in the web UI is enough:

| Job | Runner | Attaches |
| --- | --- | --- |
| `windows` | `windows-latest` | `Wavelength_X.Y.Z_x64-setup.exe`, `Wavelength.exe` |
| `android` | `ubuntu-latest` | `Wavelength-X.Y.Z-android.apk` (arm64 + armv7, signed) |

- The version is taken from the **tag** (`v0.7.0` → `0.7.0`) and written into `package.json` and
  `tauri.conf.json` before building, so the file names and Android `versionCode` always match the tag.
  Still bump both files in the repo so local builds agree.
- The Android job **fails rather than publish** an unsigned APK or one signed with a different
  certificate (it checks the SHA-256 below).
- Binaries appear on the release about 15–25 minutes after publishing (watch the **Actions** tab).
- To build or rebuild an existing release (e.g. one published before the workflow existed):
  **Actions → Release builds → Run workflow**, enter the tag (e.g. `v0.7.0`). Existing assets with the
  same name are replaced.

## In-app updates

Since in-app updates, installed apps find new releases on their own (Settings → Updates, see
[USER-GUIDE.md](USER-GUIDE.md#updates)). That relies on the release looking the way the workflow makes it:

- Tag `vX.Y.Z` (plain numbers; the app compares it with its own version) and **published**, not a draft.
- The file names stay as they are: `Wavelength_X.Y.Z_x64-setup.exe`, `Wavelength.exe` and
  `Wavelength-X.Y.Z-android.apk`. The app looks for `_x64-setup.exe`, `Wavelength.exe` and `-android.apk`.
- Apps only offer a release once its file for them is attached, so nobody gets an update in the 15–25 minutes
  before the builds finish.
- **Pre-releases** are only offered to people who ticked **Include pre-releases**. Untick pre-release on the
  release and everyone gets it on their next check.
- The APK must be signed with the release key (the workflow checks this). Android rejects an update signed with
  another key, so a test APK from option A can't be pushed through the updater.
- The version that introduced the updater (and anything older) has to be installed by hand once. Say so in
  that release's notes.

## Test builds (before a release)

Two ways to get an installer and APK to try out before shipping. Both use the signing secrets below,
so the test APK installs over the released app and keeps its settings.

### Option A: Actions artifacts (no release, works on unmerged branches)

`.github/workflows/test-build.yml` builds any branch, tag or commit and attaches the files to the run.
Nothing is published and the version isn't changed.

1. **Actions → Test builds → Run workflow.**
2. Pick the branch in **Use workflow from** (e.g. `main`, or a PR's branch), or type a branch, tag or
   commit SHA in **ref**. **Run workflow.**
3. When the run is green (about 15–25 minutes), open it and download from **Artifacts** at the bottom:
   - `wavelength-windows-<sha>`: the setup exe and the portable `Wavelength.exe`
   - `wavelength-android-<sha>`: `Wavelength-test-<sha>-android.apk`
4. The downloads are zip files; unzip, then install as usual. Artifacts are deleted after 14 days.

Notes:
- The workflow file must exist on the branch you build. Branches made before it was added: type the
  branch name in **ref** and run it from `main`.
- The APK keeps the repo's version (same Android `versionCode` as the last release), so it installs over
  that release, and the next real release installs over the test build.
- Downloading artifacts needs a GitHub login with access to the repo, so this is for you, not testers
  without an account. Use option B to share with others.

### Option B: GitHub pre-release (shareable link)

The normal release workflow also runs for pre-releases.

1. **Releases → Draft a new release**, create the tag `vX.Y.Z` on `main` (or another branch in
   **Target**), tick **Set as a pre-release**, **Publish**.
2. The exe and APK are attached as for a normal release. Pre-releases aren't shown as "Latest".
3. When it's good, edit the release, untick **pre-release** and tick **Set as the latest release**.

Notes:
- The tag must be plain `vX.Y.Z`; suffixes like `v0.9.0-beta.1` are rejected (the version feeds the
  Android `versionCode`). A pre-release uses up that version number: if testing finds bugs, fix them
  and publish `vX.Y.(Z+1)` rather than reusing the tag.

## One-time setup: signing secrets

Add these under **Settings → Secrets and variables → Actions → New repository secret**, using the
values from your local `src-tauri/gen/android/keystore.properties`:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (see below) |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` |
| `ANDROID_KEY_ALIAS` | `keyAlias` (normally `wavelength`) |
| `ANDROID_KEY_PASSWORD` | `keyPassword` |

Encode the keystore on Windows (copies it to the clipboard):
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('src-tauri\gen\android\wavelength-release.jks')) | Set-Clipboard
```
(macOS/Linux: `base64 -w0 wavelength-release.jks`.) The Windows job needs no secrets.

## Checklist

1. Update `CHANGELOG.md` (rename **Unreleased** to the new version).
2. Bump the version (both files).
3. `npx tsc` clean.
4. Commit and push to `main`.
5. On GitHub: **Releases → Draft a new release**, create tag `vX.Y.Z` on `main`, title
   `Wavelength X.Y.Z`, paste notes (template below), **Publish**. The workflow attaches the exe and APK.
6. When the Actions run is green, check the release shows the three files.

## Manual builds (fallback)

Use these if Actions is unavailable, or to test a release build locally.

1. **Use a neutral Cargo home for release builds.** Rust embeds the paths of dependency sources in
   the binary (panic messages), and the default Cargo home is inside your user folder
   (`C:\Users\<you>\.cargo`) — that would publish your username. In the same terminal as the builds:
   ```powershell
   $env:CARGO_HOME = 'C:\cargo-home'   # any folder without your name in it
   ```
   Then build Windows:
   ```bash
   npm run tauri build
   ```
2. Build Android (see DEVELOPMENT.md for the TEMP workaround on Windows):
   ```bash
   npx tauri android build --apk --target aarch64 --target armv7
   ```
3. Verify the APK is signed with the **same certificate** as the last release:
   ```bash
   apksigner verify --print-certs app-universal-release.apk
   ```
   Release certificate SHA-256: `22530aa081ae26e241d328bd4e97dfe919f2a86c995e9e4e4dcb96610c985a31`
4. Commit, tag and publish (or upload to an existing release with `gh release upload vX.Y.Z … --clobber`):
   ```bash
   git commit -am "vX.Y.Z"
   git tag vX.Y.Z && git push && git push --tags
   gh release create vX.Y.Z \
     "src-tauri/target/release/bundle/nsis/Wavelength_X.Y.Z_x64-setup.exe" \
     "src-tauri/target/release/Wavelength.exe" \
     "Wavelength-X.Y.Z-android.apk" \
     --title "Wavelength X.Y.Z" --notes-file release-notes.md
   ```
   (Rename the APK from `app-universal-release.apk` to `Wavelength-X.Y.Z-android.apk` first.)

## Release notes template

```markdown
## What's new
- …

## Fixes
- …

## Install
- **Already have Wavelength?** Settings → Updates → **Install update** (or the bar at the top).
- **Windows:** download `Wavelength_X.Y.Z_x64-setup.exe` and run it (installs over older versions).
- **Android (phone, tablet, TV):** download `Wavelength-X.Y.Z-android.apk`, allow installs from your
  file manager, open it. Installs over older versions and keeps your settings.
```

## If the signing key is lost

Android identifies an app by **package id + signing certificate**. Without
`wavelength-release.jks`, a new build can't update existing installs. Options:

- Keep the package id and sign with a new key → users must **uninstall** first (losing local settings,
  downloads and local playlists — server data is unaffected).
- Or change the package id (e.g. `com.wavelength.app`) and treat it as a new app that installs alongside.

Either way, publish a note in the release explaining what users need to do.

## Personal data check

Before publishing a release or pushing to a public repo, scan for anything personal:

```bash
git grep -n -i -E "gmail|password=|token=|192\.168\.[0-9]+\.[0-9]+[^0-9x]|C:\\\\Users\\\\"
```

`192.168.1.10` in Settings placeholders is a generic example and fine.

Check the built binaries too (should print 0):
```powershell
$t = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes('src-tauri\target\release\Wavelength.exe'))
[regex]::Matches($t, '(?i)C:\\Users\\').Count
``` Never commit
`keystore.properties`, `*.jks`, `release/`, or `src-tauri/gen/android/tauri.settings.gradle`
(it contains local paths) — all are in `.gitignore`.
