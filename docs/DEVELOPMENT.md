# Development

## Prerequisites (Windows)

| Tool | Install | Why |
|---|---|---|
| Git | `winget install Git.Git` | |
| Node.js LTS (22+; Vite 8 needs 20.19 or newer) | `winget install OpenJS.NodeJS.LTS` | Vite, TypeScript, Tauri CLI |
| Rust (stable, MSVC) | `winget install Rustlang.Rustup` | The Tauri shell |
| Visual Studio 2022 Build Tools, **C++ workload** | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` | MSVC linker for Rust |
| WebView2 | Preinstalled on Windows 10/11 | Runs the UI |

Optional, for the yt-dlp download backup: `winget install yt-dlp.yt-dlp` (brings ffmpeg).

> After winget installs, **open a new terminal** so PATH updates take effect.

## Run

```bash
npm install
npm run tauri dev
```

- Vite serves the UI on `http://localhost:1420` with hot reload; Rust rebuilds when `src-tauri/` changes.
- **After big multi-file edits, press Ctrl+R in the app window.** Hot reload can catch files mid-edit
  and keep a broken module around (symptoms: blank page, "X is not defined" on the error screen).
- Type-check only: `npx tsc`. Rust only: `cargo check --manifest-path src-tauri/Cargo.toml`.
- Tests: `npm test` (Vitest, files in `src/test/` and any `src/**/*.test.ts`), `cargo test` in `src-tauri`,
  and `npm test` in `hub/`. App tests cover pure logic (matching, merging, skins, ICY titles, update picks);
  keep anything that needs a WebView or a server out of them.

### UI-only preview in a browser

`npx vite` and open `http://localhost:1420` in Chrome. Good for layout/CSS work and anything that
talks to CORS-friendly APIs (radio-browser, SUB/WAVE). Requests to Navidrome/Plex/charts usually
fail in a plain browser (CORS) — that's expected; they work in the app because they go through Rust.
Rust commands (yt-dlp, offline downloads) don't exist in a plain browser.

## Build (Windows)

```bash
npm run tauri build
```

Outputs:
- `src-tauri/target/release/Wavelength.exe` — portable
- `src-tauri/target/release/bundle/nsis/Wavelength_<version>_x64-setup.exe` — installer

## Android

### One-time setup

1. **JDK 17**: `winget install Microsoft.OpenJDK.17` and set `JAVA_HOME` to it.
2. **Android SDK command-line tools** from <https://developer.android.com/studio#command-tools>, unzipped to
   `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`. Set `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`.
3. Accept licenses and install packages:
   ```bash
   sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358"
   ```
   Set `NDK_HOME=%ANDROID_HOME%\ndk\28.2.13676358`. (Gradle downloads newer platforms it needs automatically.)
4. Rust targets:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
5. **Turn on Windows Developer Mode** (Settings → System → For developers). The Tauri Android build
   creates symlinks, which normal accounts can only do with Developer Mode on.

### Signing

Release APKs are signed with a private key that is **not in git**:

- `src-tauri/gen/android/wavelength-release.jks`
- `src-tauri/gen/android/keystore.properties`:
  ```properties
  storeFile=wavelength-release.jks
  storePassword=…
  keyAlias=wavelength
  keyPassword=…
  ```

**Every update must be signed with the same key**, or Android refuses to install it over the old
version (users would have to uninstall and lose their settings). Back these two files up somewhere safe.
If you're a new maintainer without the key, see [RELEASING.md](RELEASING.md#if-the-signing-key-is-lost).

To create a brand-new key (only for a fork / new app id):
```bash
keytool -genkeypair -v -keystore wavelength-release.jks -alias wavelength -keyalg RSA -keysize 2048 -validity 10000
```

### Build the APK

```powershell
# Windows: Java's local socket breaks on 8.3 short temp paths (C:\Users\ABCDEF~1\…) — use a plain temp dir
$env:TEMP = 'C:\gradletmp'; $env:TMP = 'C:\gradletmp'
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\gradletmp -Djava.io.tmpdir=C:\gradletmp'
npx tauri android build --apk --target aarch64 --target armv7
```

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
(arm64 + armv7: covers phones, tablets, Google TV / Fire TV / older 32-bit TVs).

Verify before shipping:
```bash
apksigner verify --print-certs app-universal-release.apk   # same SHA-256 as previous releases
aapt2 dump badging app-universal-release.apk                # versionCode went up, permissions present
```

### Live development on a device

```bash
npx tauri android dev      # needs a device with USB debugging, or an emulator
```

## Where to look when…

| You want to… | Start in |
|---|---|
| Change how something looks | `src/styles.css` (search the class name) |
| Change a page | `src/views/<Page>.tsx` |
| Fix a server integration | `src/sources/<server>.ts` + [SOURCES.md](SOURCES.md) |
| Fix playback | `src/store/player.ts` (`loadCurrent`) and `src/player/engine.ts` |
| Fix Android-only behaviour | `src-tauri/gen/android/app/src/main/…` (Kotlin + manifest) |
| Add a native capability | `src-tauri/src/*.rs`, register in `lib.rs` |

## Code style

- TypeScript strict mode; `npx tsc` must be clean before committing.
- **Zustand selectors must return something stable.** `useSettings((s) => s.sources.filter(…))` makes a new
  array every render, which zustand 5 treats as a change and loops forever. Wrap it in `useShallow`
  (`zustand/react/shallow`), select the raw value and derive it with `useMemo`, or return a primitive.
- Big pages that aren't on the startup path are lazy-loaded in `App.tsx` (`page(() => import(…), 'Name')`).
  A new page that's only opened sometimes should be added there too.
- Match the surrounding code: small functions, a one-line comment explaining *why* when it isn't obvious.
- New UI text: short, friendly, and say what to do next on errors ("Couldn't reach deemix — check its URL in Settings").
- Keep the `MusicSource` contract: pages don't call servers directly.
