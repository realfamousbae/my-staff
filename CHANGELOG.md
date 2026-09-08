# Changelog

Changes affecting users and contributors are recorded here. During alpha development, API and data-format compatibility may still change.

## Unreleased

Planned work is tracked in [ROADMAP.md](ROADMAP.md) and GitHub Issues.

## 0.2.0-alpha.1 · 2026-09-08

Minor alpha release addressing Android feedback in [issue #6](https://github.com/realfamousbae/my-staff/issues/6). App package version: `0.2.0`, Android version code: `2`.

### Added

- My Staff launcher name and a white M icon on purple, including adaptive and themed Android icons.
- An item-photo gallery with full-screen viewing of the original and additional angles, including photos saved by earlier versions.
- Navigation history for Android's system back button and in-app back controls.

### Fixed

- Back from nested screens now returns to the previous screen or originating tab. Saved captures are removed from navigation history.
- Additional photos are visible after attaching them; picker and attachment errors are shown instead of failing silently.
- Photo import works without camera permission. Cancelling a replacement photo keeps the current preview.
- Unsaved item edits require confirmation before leaving and are no longer reset by a sync refresh.
- Internal screens respect system insets; long button labels wrap within the available width.
- Repeated taps during photo saving/attachment and edit saving are ignored.

### Still pending

The photo-search and automatic card-filling proposal in issue #6 requires a separate provider/workflow decision. This release does not enable AI or upload photos to a search provider.

## 0.1.0-alpha.1 · 2026-09-07

First public-development snapshot. App package version: `0.1.0`.

### Added

- Android-first Expo client for photographed energy drink cans and Pringles tubes.
- Local cards, camera/import, notes, filters, extra angles and capture sessions.
- SQLite persistence, original-photo storage and interrupted-capture recovery.
- NestJS API/worker, PostgreSQL, private media and optional S3 storage.
- Stable operation retries, optimistic updates and transactional processing through pg-boss.
- Catalog proposals and editor confirmation/merge routes.
- Device and server ZIP archives with integrity validation.
- Optional AI provider adapters, disabled by default.
- Automated checks, native emulator verification and an ARM64 test APK.

### Known limits

Physical S24 Ultra validation, iOS, AI quality evaluation, large-collection archives and production-service hardening remain pending. See the README and verification report.
