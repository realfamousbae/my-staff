# Getting started

[Documentation](README.md) · [Project overview](../README.md)

## Prerequisites

- Node.js 22 (repository engine range: `>=22.12 <25`).
- pnpm 10.34.5, as specified in `package.json`.
- Docker Engine/Desktop with Compose, already running.
- For native Android builds: JDK 21, Android SDK Platform 36, build tools, and platform-tools (`adb`). Gradle may request additional SDK components during its first build.

The checked-in lockfile is authoritative. Do not replace it with npm/yarn lockfiles.

## Backend

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev:backend
```

`setup:local` starts PostgreSQL, builds shared contracts, and applies migrations. `dev:backend` starts the API and worker. The API listens on port 3000; the development PostgreSQL service is bound to `127.0.0.1:55432`.

The local runner provides development defaults. To override them, copy `.env.example` to `.env` and edit it locally. Never commit `.env`. The sample database password is for local development only.

For separate terminals:

```sh
pnpm dev:server
pnpm dev:worker
```

## Standalone app

Download the APK and `.sha256` file from the [prerelease](https://github.com/realfamousbae/my-staff/releases/tag/v0.1.0-alpha.1). Place them in `artifacts/` if following the commands below.

```sh
# macOS; Linux can use sha256sum -c instead
cd artifacts
shasum -a 256 -c my-collection-android.apk.sha256
cd ..
adb install -r artifacts/my-collection-android.apk
```

The APK starts without a backend. Begin with a photo or import, choose a category, save, and edit the new card. Android will request camera permission when needed.

### Emulator

Set the API address to `http://10.0.2.2:3000` in app settings before registering. The recorded native run used API 36 ARM64. On the tested Mac, `-gpu host -cores 2` avoided a software-renderer hang; that is an emulator setting, not an app requirement.

### Physical Android over USB

Enable USB debugging and authorize your computer on the phone:

```sh
adb devices
adb reverse tcp:3000 tcp:3000
adb install -r artifacts/my-collection-android.apk
```

Use `http://127.0.0.1:3000` in app settings. USB forwarding may need to be re-established after reconnecting or restarting the phone. Non-local API destinations must use HTTPS.

## Development client and builds

```sh
pnpm dev:mobile
```

Use an Expo development client compatible with this SDK. A JS/web preview is not a camera or SQLite acceptance test.

```sh
export JAVA_HOME="/path/to/jdk-21"
export ANDROID_HOME="/path/to/android-sdk"
pnpm apk:android
```

The build script runs Android prebuild without Xcode, builds an ARM64 APK, and writes the APK and hash to `artifacts/`. Its fallback paths are specific to Homebrew on Apple Silicon; set the variables explicitly on other machines. The generated `android/` and `ios/` folders are not committed. The manual **Android APK** workflow also provides a build artifact.

## Checks

```sh
pnpm verify
pnpm format:check
pnpm export:android
```

PostgreSQL must be available for integration tests. `TEST_DATABASE_URL` defaults to the local development connection; each suite creates and drops its own random schema. Tests reject non-loopback hostnames. They do not truncate the application's public schema.

## Stop and clean up

Stop development processes with Ctrl+C in their terminals. Stop local PostgreSQL with `pnpm infra:stop`. Do not remove its volume if it contains a collection.

After preserving the standalone APK:

```sh
pnpm clean:cache --dry-run
pnpm clean:cache
```

Cleanup is refused while the project's Android build is active. It removes generated Gradle/Expo output folders, including native Expo build outputs inside the dependency directory. It preserves source files, installed dependencies, SDKs, collection data, original photos, and the APK.

## Troubleshooting

| Symptom                                   | Check                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Docker/Compose unavailable                | Start Docker Desktop/Engine and confirm `docker compose version`.                                                 |
| Connection refused on a phone             | Check API process, USB forwarding, and the API address; emulator and USB addresses differ.                        |
| Blank or missing photos after a new login | Use **restore originals** in settings; a server snapshot does not automatically download every original.          |
| ZIP exceeds the size limit                | Current alpha cannot export an entire large collection in one file; multipart/streaming backup is on the roadmap. |
| Artwork does not become a studio render   | AI is off by default; see [server configuration](../apps/server/docs/server.md).                                  |
| Data changed on another device            | Preserve the local draft and report the conflict; a full comparison/resolution screen is still pending.           |
