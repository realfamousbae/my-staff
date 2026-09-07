# HTTP API

The current API uses `/v1`. JSON request bodies are validated with Zod. This is a prototype contract; read the shared [schemas](../packages/api-contracts/src/index.ts) and controller implementations when integrating a client.

## Authentication

`POST /v1/auth/register` and `POST /v1/auth/login` accept `email` and `password`. Passwords must contain at least 12 characters. Authenticated requests send `Authorization: Bearer <token>`. `GET /v1/auth/me` returns the current account. There is no email verification or password recovery yet.

## Routes

| Method | Route                              | Purpose                                                             |
| ------ | ---------------------------------- | ------------------------------------------------------------------- |
| GET    | `/v1/items`                        | List the current user's items; `includeDeleted=true` includes trash |
| PUT    | `/v1/items/:id`                    | Create an item using a client-generated UUID                        |
| PATCH  | `/v1/items/:id`                    | Edit, link an edition, delete or restore an item                    |
| POST   | `/v1/items/:id/media`              | Allocate an original-media upload                                   |
| PUT    | `/v1/uploads/:id`                  | Upload raw bytes to the local storage driver                        |
| POST   | `/v1/media/:id/upload-ticket`      | Refresh the ticket for an allocated upload                          |
| POST   | `/v1/media/:id/confirm`            | Verify and confirm the uploaded original                            |
| GET    | `/v1/media/:id/content`            | Read private media belonging to the current user                    |
| POST   | `/v1/items/:id/process`            | Request processing after upload confirmation                        |
| GET    | `/v1/catalog/editions`             | Search visible editions with `q` and `category`                     |
| POST   | `/v1/catalog/editions`             | Propose a draft edition                                             |
| POST   | `/v1/catalog/editions/:id/confirm` | Confirm an edition; editor role required                            |
| POST   | `/v1/catalog/editions/:id/merge`   | Merge editions; editor role required                                |
| GET    | `/v1/export`                       | Download the authenticated collection as ZIP                        |
| POST   | `/v1/import`                       | Import a ZIP supplied as raw request bytes                          |

## Writes and uploads

Retryable writes carry an `operationId` UUID. Item edits and catalog moderation also use `expectedVersion` for optimistic concurrency. Reuse the same operation ID for a retry of the same operation; do not generate a new ID merely because a response was lost.

An original upload declares its byte length, SHA-256 and MIME type. The server accepts JPEG, PNG and WebP up to 30 MiB per file. Allocation, byte upload and confirmation are separate steps. Use the returned upload ticket rather than constructing a storage URL: S3 and local storage have different upload paths. A confirmed original is immutable.

The API checks ownership of personal items and media. Confirmed catalog editions are shared; a draft is visible to its creator. Do not treat a catalog edition as ownership of a personal item.

## Archives and processing

For `POST /v1/import`, send the ZIP as raw bytes with `Content-Type: application/zip` and the bearer authorization header.

The server archive contains `manifest.json` and media. The mobile offline archive uses a separate `my-collection-local` manifest. Do not assume these formats are interchangeable. Archive processing is bounded to 200 MB compressed/source data and 400 MB declared expanded import data; large collections need future batching support.

AI is disabled by default. Disabled processing preserves the original and records a manual result. An accepted processing request does not imply successful recognition or generated artwork. See [architecture](architecture.md) and [server operations](../apps/server/docs/server.md).
