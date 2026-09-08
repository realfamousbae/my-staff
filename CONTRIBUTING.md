# Contributing

Thanks for helping make the collection workflow useful in practice. This project is an early prototype; discuss large product or architecture changes in an issue before implementing them.

## Set up

Follow [getting started](docs/getting-started.md), then create a focused branch:

```sh
git switch -c fix/short-description
pnpm install --frozen-lockfile
pnpm setup:local
```

## Before opening a pull request

```sh
pnpm verify
pnpm check:mobile-deps
pnpm format:check
```

For mobile changes, also run `pnpm export:android` and test affected native behavior on Android. A successful JS bundle does not prove that camera, SQLite, file access or permissions work.

Integration tests require loopback PostgreSQL and create isolated schemas. Never weaken their database guards or point tests at a live service. Keep external AI disabled for ordinary tests.

React Native upgrades must follow the installed Expo SDK's supported versions. Dependabot leaves minor/major React Native upgrades to that coordinated workflow; CI checks mobile dependency compatibility with Expo. Vitest is pinned to the same version at the workspace root and in the server so tests use a single runner.

## Boundaries to preserve

- Keep original photos independent from generated images and catalog guesses.
- Preserve stable IDs, owner boundaries, immutable request retries and pending local edits.
- Keep provider keys and object-storage credentials off the mobile client.
- Distinguish physical collection items from catalog editions.
- Do not infer rarity from an incomplete catalog.
- Do not commit `.env`, real collection exports, signing keys or private photos.

Use small changes with a clear reason. Add regression tests for meaningful failures rather than tests that only restate the implementation. Update API/contracts and documentation together when behavior changes.

## Pull requests

Explain the problem, resulting behavior, relevant verification and remaining limits. For UI work, attach clearly labeled screenshots and state the device/emulator used. Use your own media or clearly identified test fixtures. English and Russian reports are both welcome.

The PR template is a guide, not a request to claim checks you did not run. Maintainers may ask for a smaller scope or additional evidence before merging.

## Reports and conduct

Use the bug/feature issue forms. Report security problems privately through [SECURITY.md](SECURITY.md). Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## After development

Stop your development processes. Once an APK is preserved in `artifacts/`, use `pnpm clean:cache` to remove generated project build caches. Keep collection data and original photos.

## Licensing

The project license is still being decided. The repository will document the decision explicitly; do not assume a license that is not present.
