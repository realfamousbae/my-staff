# Server operation

Run PostgreSQL, then use `pnpm db:migrate`, `pnpm dev:server`, and `pnpm dev:worker`.
`DATABASE_URL` is required. Development storage uses `STORAGE_DRIVER=local`; S3 requires `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, and optionally `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true`.

The API is rooted at `/v1`. It provides email/password sessions, `/items`, private `/media`, `/catalog/editions`, `/export`, and `/import`. Originals are private and immutable after confirmation. The local driver verifies image signatures; the S3 driver streams and hashes the pinned staged object before copying it to the immutable key.

Catalog rules: confirmed editions are visible to every user, drafts only to their creator. Confirmation and merge require an editor account and expected version. Grant that role deliberately with:

`DATABASE_URL=... pnpm --filter @my-staff/server catalog:grant-editor person@example.com`

The command only updates the exact supplied existing email; it never promotes accounts automatically.

Exports are ZIP archives with `manifest.json` and media. A single archive is limited to 200 MB compressed/source media and 400 MB declared expanded import data. Large collections such as 645 high-resolution originals may exceed this limit: export them in smaller collections only after pagination/batching support is added. The current API deliberately refuses an oversized one-shot export instead of producing an incomplete archive.

AI processing is disabled by default. Without explicit `AI_ENABLED=true` and all provider/budget variables, processing records manual recognition and displays the confirmed original as `original-photo`; it does not claim to have generated studio artwork.
