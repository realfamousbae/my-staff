# Roadmap

Status: active development. This is a prioritised direction, not a release-date commitment. Track concrete work through [GitHub Issues](https://github.com/realfamousbae/my-staff/issues).

## Current baseline · 0.2 alpha

- [x] Android-first Expo client and standalone ARM64 APK.
- [x] Photo capture/import, personal cards, categories, notes and filters.
- [x] Persistent originals, SQLite and interrupted-capture recovery.
- [x] Authenticated sync, private media, checksums and processing queue.
- [x] Catalog proposals and editor confirmation/merge APIs.
- [x] Local ZIP export/import and server archives.
- [x] PostgreSQL/HTTP tests and native emulator acceptance.
- [x] Android back navigation, additional-photo gallery and camera-independent import.

## Next · collector validation

- [ ] Test on Samsung Galaxy S24 Ultra with real cans and Pringles tubes.
- [ ] Collect representative packaging examples and agree edition distinctions.
- [ ] Make capture sessions and repeated collection entry more convenient.
- [ ] Improve camera-denial, offline and conflict feedback in the interface.
- [ ] Validate originals and backup/recovery with a substantially larger collection.

## Reliability and scale

- [ ] Streaming or multipart archives beyond the current 200 MB cap.
- [ ] Incremental/paginated synchronization.
- [ ] A clear screen for reviewing and resolving conflicting edits.
- [ ] Editor tooling and evidence-backed catalog corrections.
- [ ] Evaluate Android background scheduling and its practical limits.

## Optional AI

- [ ] Resolve the photo-search/autofill request from issue #6: provider, privacy, cost and confirmation of suggestions.
- [ ] Agree model selection and an explicit test budget.
- [ ] Measure recognition quality against real packaging editions.
- [ ] Check whether studio rendering preserves labels, language and design.
- [ ] Add review and recovery UX for rejected or uncertain results.
- [ ] Add catalog candidate retrieval before scaling past 1,000 editions per category.

## Before a public service

- [ ] Deployment, monitoring, tested server backups and restore procedure.
- [ ] Account recovery, email verification and abuse/rate controls.
- [ ] Storage retention, deletion rules and user-facing privacy documentation.
- [ ] Production Android signing and distribution process.
- [ ] iOS build and device validation.

Rarity, social feeds, trading, leaderboards and other game mechanics remain deferred until the collection workflow is dependable.
