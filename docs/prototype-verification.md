# Prototype verification

## 0.2.0-alpha.1 · 8 September 2026

`pnpm verify` passed with **45 tests in 7 files**, including real PostgreSQL/HTTP integration checks and four navigation regressions. `pnpm format:check`, `pnpm export:android`, and the ARM64 release APK build passed. The bundled mobile sources were compared with the working tree. The PR's GitHub Actions verification also passed.

The APK was installed with `adb install -r` over 0.1.0 on the Android API 36 ARM64 emulator. Both existing test cards and their original images remained available. The package ID is still `com.mystaff.collection`; versionName is `0.2.0` and versionCode is `2`. Both APKs have the same signing-certificate SHA-256 (`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`).

Native acceptance with synthetic images covered:

- System Back from settings returns to the collection; Back at the collection root leaves the app.
- Add a detail photo from Android's picker: the gallery immediately changes from one photo to two, without replacing the original.
- Open the detail photo full-screen; system Back closes the viewer and keeps the card open.
- Force-stop and reopen the app: both gallery photos remain available.
- Back from an unchanged editor returns to the card. For an edited title, dismissing the keyboard and pressing Back shows the unsaved-changes confirmation; discarding keeps the original title.
- Revoke camera permission, import a photo, cancel a replacement selection while retaining the preview, and save a new card.
- Back after saving returns directly to the collection, now containing three test items.
- Visually inspect the gallery, full-screen photo, preview and system insets on a narrow 320×640 display.
- Verify the My Staff label and purple M icon in the Android launcher.

The installed APK bytes match the release artifact. SHA-256:

```text
6d24c51942a9cddbd01de7c4b2c0156f58fcf8f5e560f1e943524b19883439c0
```

No AI/photo-search calls were made. Photo search and automatic card filling from issue #6 remain pending a provider/workflow decision. Physical Samsung retesting, the remaining navigation branches, simulated picker/storage failures and the sync-refresh/edit interaction were not separately exercised on a device in this pass. The emulator required a cold restart with host rendering; synthetic QA artifacts stay outside Git.

## 0.1.0-alpha.1 baseline

Recorded on **7 September 2026**. These are results for the Android prototype, not a claim of production readiness.

## Automated checks

`pnpm verify` passed: type checks, **41 tests in 6 files**, and the server build. The suite includes PostgreSQL integration checks, media and provider behavior, local archive checks and mobile synchronization regressions. Formatting passed separately. GitHub Actions reruns the repository checks on pushes and pull requests; consult the actual workflow status for newer commits.

## Installed Android APK

The release APK was installed on an ARM64 Android API 36 emulator. Its installed bytes matched the distributed APK:

```text
5d863ce6b712a5e0e05bfe65d93614d5f74bc2548a8c8ec7191554a84f4d6c1d
```

The following flows were exercised with synthetic images and a test account:

- Add an energy drink and a Pringles tube through the Android photo picker.
- Capture a photo using the emulator camera and persist a card.
- Open and flip a card to inspect its original image.
- Sign in and synchronize two items and confirmed originals to the local API.
- Export a ZIP and validate its two items, image entries and checksums.
- Restore that ZIP into an empty offline collection; repeat without duplicates.
- Edit a title, search, filter by category, delete and restore an item.
- Force-stop and reopen the app with restored photos and edits retained.

No AI provider calls were made. The emulator camera supplied a black image, so that check establishes capture/persistence behavior only. The [README screenshots](../README.md#inside-the-prototype) use synthetic test content; they are not a populated product catalog.

## Not yet verified

Samsung Galaxy S24 Ultra camera quality, a physical-device session, iOS, real AI providers, S3 infrastructure, public hosting, background synchronization and an entire 645-item collection remain unverified. The current one-shot archive limits are a known constraint for that collection size.

Raw local test databases, logs, account data and backup archives are excluded from Git. The APK and checksum are distributed through the GitHub prerelease.
