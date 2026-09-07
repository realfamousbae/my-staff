# Security

## Current support scope

The project is an actively developed alpha intended for local testing. Security fixes target the current `main` branch; no long-term support or production-readiness guarantee is provided.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** flow for a private report. Do not open a public issue containing exploit details, credentials, tokens, private images, or a collection backup.

Include the affected revision, a minimal reproduction, expected/actual behavior and potential impact. Use synthetic data. The project does not currently promise a response-time SLA.

## Prototype boundaries

- There is no hosted public API operated with this release.
- Sample Compose credentials are for local development only.
- Password reset, email verification, abuse/rate controls and production operations are still roadmap items.
- API/worker and S3/provider credentials belong on the server; never embed them in the APK.
- Treat ZIP backups as sensitive, unencrypted files containing collection metadata and photos.
- The APK uses a test signing key; it is not a production store build.
- External AI is disabled by default. Enabling it sends processing inputs to the configured provider and can incur charges.

For storage and backup behavior, see [server operations](apps/server/docs/server.md) and [architecture](docs/architecture.md).
