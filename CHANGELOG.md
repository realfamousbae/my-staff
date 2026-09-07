# Changelog

Changes affecting users and contributors are recorded here. During alpha development, API and data-format compatibility may still change.

## Unreleased

Planned work is tracked in [ROADMAP.md](ROADMAP.md) and GitHub Issues.

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
