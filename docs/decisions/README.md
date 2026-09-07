# Architecture decisions

These decisions describe the current prototype. Revisit them when real-device testing supplies evidence; planned features are tracked in the [roadmap](../../ROADMAP.md).

| Decision                         | Choice                                                | Reason and consequence                                                                                                    |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Android first                    | Expo / React Native, shared TypeScript code           | Test on Android now while keeping iOS feasible. iOS builds and platform behavior remain unverified.                       |
| Local persistence first          | SQLite metadata and persistent local photo files      | Capture must survive an unavailable backend. The client owns a durable outbox and needs explicit retry/conflict behavior. |
| Separate ownership from identity | Personal item references a catalog edition            | Multiple collectors can own the same edition; missing catalog entries do not block capture.                               |
| Preserve originals               | Immutable confirmed originals; artwork is derived     | Recognition or rendering failure must not lose the collector's source photo. Storage and backups must include originals.  |
| Modular monolith                 | NestJS modules, PostgreSQL, a separate worker process | Keep domain boundaries without introducing multiple network services for one initial user.                                |
| Optional AI                      | Provider adapters, disabled by default                | Paid processing is outside the essential capture path. Unknown provider outcomes require care before retrying.            |
| Portable backup                  | Versioned ZIP manifests with checksums                | Offline recovery is inspectable and testable. Current size limits require future batching for a large collection.         |
| Rarity postponed                 | No rarity rules in the initial workflow               | Validate collecting and identity first. An unknown edition is not evidence of real-world rarity.                          |

Changes to ownership, archive compatibility, upload confirmation or retry semantics should include a short decision note explaining the trigger, alternatives and migration impact.
