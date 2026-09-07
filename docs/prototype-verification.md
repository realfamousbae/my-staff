# Prototype verification

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
