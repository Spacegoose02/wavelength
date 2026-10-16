# Releasing

## Versioning

- Semantic-ish: `MAJOR.MINOR.PATCH`. Bump **MINOR** for features, **PATCH** for fixes.
- The version lives in **two places** — keep them equal:
  - `src-tauri/tauri.conf.json` → `"version"` (drives the installer name and Android `versionCode`)
  - `package.json` → `"version"`
- Android `versionCode` is derived from it (`0.4.1` → `4001`). It must always go **up**, or the APK
  won't install as an update.

## Checklist

1. Update `CHANGELOG.md`.
2. Bump the version (both files).
3. `npx tsc` clean.
4. **Use a neutral Cargo home for release builds.** Rust embeds the paths of dependency sources in
   the binary (panic messages), and the default Cargo home is inside your user folder
   (`C:\Users\<you>\.cargo`) — that would publish your username. In the same terminal as the builds:
   ```powershell
   $env:CARGO_HOME = 'C:\cargo-home'   # any folder without your name in it
   ```
   Then build Windows:
   ```bash
   npm run tauri build
   ```
5. Build Android (see DEVELOPMENT.md for the TEMP workaround on Windows):
   ```bash
   npx tauri android build --apk --target aarch64 --target armv7
   ```
6. Verify the APK is signed with the **same certificate** as the last release:
   ```bash
   apksigner verify --print-certs app-universal-release.apk
   ```
   Release certificate SHA-256: `22530aa081ae26e241d328bd4e97dfe919f2a86c995e9e4e4dcb96610c985a31`
7. Commit, tag and publish:
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
