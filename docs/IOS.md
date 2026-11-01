# The iPhone and iPad app

Wavelength's iPhone app is the same Tauri app as the desktop and Android ones, built for iOS. The repo has
everything except what only Apple can give you: a developer account and its signing keys. Once those are in the
repo's secrets, each release also builds the iPhone app and sends it to TestFlight, where you (and up to 10,000
testers you invite) install it with Apple's TestFlight app.

## What you need

1. **An Apple Developer Program membership** ($99 a year) at <https://developer.apple.com/programs/>. A free
   Apple ID can only put the app on your own phone from Xcode for 7 days at a time.
2. **An app record** in App Store Connect (<https://appstoreconnect.apple.com> → Apps → +): platform iOS, bundle
   ID `com.tonearm.app` (register it under Certificates, Identifiers & Profiles → Identifiers first), any name
   and SKU.
3. **An App Store Connect API key**: Users and Access → Integrations → App Store Connect API → +, access
   **App Manager**. Download the `.p8` file (you only get one chance) and note the **Key ID** and **Issuer ID**.
4. Your **Team ID** (Membership details on developer.apple.com).

## Repo secrets

In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | Value |
| --- | --- |
| `APPLE_API_KEY_P8` | the whole text of the `.p8` file |
| `APPLE_API_KEY_ID` | the Key ID |
| `APPLE_API_ISSUER` | the Issuer ID |
| `APPLE_TEAM_ID` | the Team ID (also used to sign the Mac app) |

The `ios` job in `.github/workflows/release.yml` skips itself, with a notice, until all four are there. With
them, it makes the Xcode project (`tauri ios init`), builds and signs with automatic provisioning, and uploads
the `.ipa` to TestFlight. Apple takes a few minutes to process a build before it shows up.

## Building on your own Mac

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run tauri ios init        # makes src-tauri/gen/apple (not kept in the repo)
npm run tauri ios dev         # in the simulator, or on a plugged-in phone
```

Open `src-tauri/gen/apple/*.xcodeproj` in Xcode to pick your team under Signing & Capabilities if it asks.

## What's different on iPhone

- `src-tauri/Info.ios.plist` is merged into the app's Info.plist: background audio (keeps playing with the
  screen off, with lock-screen controls), local-network access for your server and for casting, and plain
  `http://` to servers on your network.
- Logins are kept in the iOS keychain (`src-tauri/src/secrets.rs`).
- Like Android: no yt-dlp or SMB downloads on the phone itself (a Hub with yt-dlp still works), no Discord
  status and no bit-perfect output. Casting, offline downloads, the Hub and everything else work.
- Apple's review rules apply if you ever submit it to the public App Store; TestFlight and personal use don't
  need that.
