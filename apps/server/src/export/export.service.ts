import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import { DbService } from "../db/db.service";
import { StorageService } from "../storage/storage.service";

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024,
  MAX_EXPANDED_BYTES = 400 * 1024 * 1024,
  MAX_FILES = 2_000;
const sha = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const stable = (owner: string, id: string) => {
  const h = createHash("sha256").update(`${owner}:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
async function bytes(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

@Injectable()
export class ExportService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}
  async create(ownerId: string) {
    return this.db.tx(async (c) => {
      const items = (
          await c.query(
            "SELECT * FROM collection_items WHERE owner_id=$1 ORDER BY created_at",
            [ownerId],
          )
        ).rows,
        ids = items.map((x) => x.id);
      const sessions = ids.length
        ? (
            await c.query(
              "SELECT DISTINCT s.* FROM capture_sessions s JOIN collection_items i ON i.capture_session_id=s.id WHERE i.owner_id=$1",
              [ownerId],
            )
          ).rows
        : [];
      const media = ids.length
        ? (
            await c.query(
              "SELECT * FROM media_assets WHERE owner_id=$1 AND item_id=ANY($2::uuid[]) AND state='confirmed'",
              [ownerId, ids],
            )
          ).rows
        : [];
      const declaredBytes = media.reduce(
        (total, asset) => total + Number(asset.byte_size),
        0,
      );
      if (declaredBytes > MAX_ARCHIVE_BYTES)
        throw new BadRequestException({
          code: "EXPORT_TOO_LARGE",
          message: "Export exceeds the current 200 MB archive limit",
        });
      const artwork = ids.length
        ? (
            await c.query(
              "SELECT * FROM artwork_revisions WHERE item_id=ANY($1::uuid[])",
              [ids],
            )
          ).rows
        : [];
      const editions = ids.length
        ? (
            await c.query(
              "SELECT DISTINCT e.* FROM editions e JOIN collection_items i ON i.edition_id=e.id WHERE i.owner_id=$1",
              [ownerId],
            )
          ).rows
        : [];
      const files: Record<string, Uint8Array> = {};
      for (const asset of media)
        files[`media/${asset.id}`] = await bytes(
          await this.storage.read(asset.id),
        );
      const total = Object.values(files).reduce(
        (n, file) => n + file.length,
        0,
      );
      if (total > MAX_ARCHIVE_BYTES)
        throw new BadRequestException({
          code: "EXPORT_TOO_LARGE",
          message: "Export exceeds the current 200 MB archive limit",
        });
      const manifest = {
        version: 1,
        archiveOwnerId: ownerId,
        items,
        sessions,
        media: media.map(({ object_key, ...x }) => x),
        artwork,
        editions,
        checksums: Object.fromEntries(
          Object.entries(files).map(([p, v]) => [p, sha(v)]),
        ),
      };
      files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
      const archive = Buffer.from(zipSync(files, { level: 6 }));
      if (archive.length > MAX_ARCHIVE_BYTES)
        throw new BadRequestException({
          code: "EXPORT_TOO_LARGE",
          message: "Compressed export exceeds 200 MB",
        });
      return archive;
    }, "REPEATABLE READ");
  }
  async restore(ownerId: string, archive: Buffer) {
    if (archive.length > MAX_ARCHIVE_BYTES)
      throw new BadRequestException({
        code: "IMPORT_TOO_LARGE",
        message: "Archive exceeds 200 MB",
      });
    let files: Record<string, Uint8Array>;
    let declared = 0,
      entries = 0;
    const names = new Set<string>();
    try {
      files = unzipSync(archive, {
        filter: (file) => {
          entries++;
          declared += file.originalSize;
          if (
            entries > MAX_FILES ||
            declared > MAX_EXPANDED_BYTES ||
            file.originalSize < 0 ||
            file.name.length > 300 ||
            names.has(file.name)
          )
            throw new Error("unsafe archive directory");
          names.add(file.name);
          return (
            file.name === "manifest.json" ||
            /^media\/[0-9a-f-]{36}$/.test(file.name)
          );
        },
      });
    } catch {
      throw new BadRequestException({
        code: "INVALID_ARCHIVE",
        message: "Invalid or unsafe ZIP archive",
      });
    }
    if (entries !== Object.keys(files).length)
      throw new BadRequestException({
        code: "INVALID_ARCHIVE",
        message: "Archive contains unsupported paths",
      });
    let m: any;
    try {
      m = JSON.parse(Buffer.from(files["manifest.json"] ?? []).toString());
    } catch {
      throw new BadRequestException({
        code: "INVALID_ARCHIVE",
        message: "Invalid manifest",
      });
    }
    if (
      m.version !== 1 ||
      typeof m.archiveOwnerId !== "string" ||
      !Array.isArray(m.items) ||
      !Array.isArray(m.media) ||
      !Array.isArray(m.sessions) ||
      !Array.isArray(m.artwork)
    )
      throw new BadRequestException({
        code: "INVALID_ARCHIVE",
        message: "Unsupported manifest",
      });
    const allowed = new Set([
      "manifest.json",
      ...m.media.map((a: any) => `media/${a.id}`),
    ]);
    if (
      [...names].some((name) => !allowed.has(name)) ||
      Object.keys(files).some((name) => !allowed.has(name))
    )
      throw new BadRequestException({
        code: "INVALID_ARCHIVE",
        message: "Archive has unexpected paths",
      });
    for (const asset of m.media) {
      const file = files[`media/${asset.id}`];
      if (
        !file ||
        m.checksums?.[`media/${asset.id}`] !== sha(file) ||
        asset.sha256 !== sha(file)
      )
        throw new BadRequestException({
          code: "CHECKSUM_MISMATCH",
          message: `Invalid media/${asset.id}`,
        });
    }
    const sameOwner = m.archiveOwnerId === ownerId;
    let imported = 0,
      skipped = 0,
      recoveredMedia = 0;
    await this.db.tx(async (c) => {
      const itemId = (id: string) => (sameOwner ? id : stable(ownerId, id)),
        sessionId = (id: string) => (sameOwner ? id : stable(ownerId, id)),
        mediaId = (id: string) => (sameOwner ? id : stable(ownerId, id));
      for (const session of m.sessions) {
        const id = sessionId(session.id);
        await c.query(
          "INSERT INTO capture_sessions(id,owner_id,title,created_at,closed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
          [
            id,
            ownerId,
            session.title ?? null,
            session.created_at ?? new Date(),
            session.closed_at ?? null,
          ],
        );
        const owner = await c.query(
          "SELECT owner_id FROM capture_sessions WHERE id=$1",
          [id],
        );
        if (owner.rows[0]?.owner_id !== ownerId)
          throw new BadRequestException({
            code: "IMPORT_OWNERSHIP_CONFLICT",
            message: "Archive session belongs to another account",
          });
      }
      for (const source of m.items) {
        const id = itemId(source.id);
        const exists = await c.query(
          "SELECT owner_id FROM collection_items WHERE id=$1",
          [id],
        );
        if (exists.rowCount && exists.rows[0].owner_id !== ownerId)
          throw new BadRequestException({
            code: "IMPORT_OWNERSHIP_CONFLICT",
            message: "Archive item belongs to another account",
          });
        if (!exists.rowCount) {
          const edition = source.edition_id
            ? ((
                await c.query(
                  "SELECT id FROM editions WHERE id=$1 AND (status='confirmed' OR created_by=$2)",
                  [source.edition_id, ownerId],
                )
              ).rows[0]?.id ?? null)
            : null;
          await c.query(
            "INSERT INTO collection_items(id,owner_id,category,edition_id,capture_session_id,title,notes,captured_at,version,input_revision,recognition_status,presentation_status,deleted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
            [
              id,
              ownerId,
              source.category,
              edition,
              source.capture_session_id
                ? sessionId(source.capture_session_id)
                : null,
              source.title ?? "",
              source.notes ?? "",
              source.captured_at,
              source.version ?? 1,
              source.input_revision ?? 0,
              source.recognition_status ?? "unassigned",
              source.presentation_status ?? "pending",
              source.deleted_at,
              source.created_at ?? new Date(),
              source.updated_at ?? new Date(),
            ],
          );
          imported++;
        } else skipped++;
        for (const asset of m.media.filter(
          (x: any) => x.item_id === source.id,
        )) {
          const mid = mediaId(asset.id),
            present = await c.query(
              "SELECT 1 FROM media_assets WHERE id=$1 AND owner_id=$2",
              [mid, ownerId],
            );
          if (present.rowCount) continue;
          const file = files[`media/${asset.id}`];
          await this.storage.writeImmutable(mid, file, asset.mime_type);
          await c.query(
            "INSERT INTO media_assets(id,owner_id,item_id,role,mime_type,byte_size,sha256,object_key,state,immutable_at,confirmed_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',now(),now(),$9)",
            [
              mid,
              ownerId,
              id,
              asset.role,
              asset.mime_type,
              file.length,
              asset.sha256,
              `originals/${mid}`,
              asset.created_at ?? new Date(),
            ],
          );
          recoveredMedia++;
        }
      }
      for (const art of m.artwork) {
        const iid = itemId(art.item_id),
          mid = art.media_id ? mediaId(art.media_id) : null;
        const item = await c.query(
          "SELECT 1 FROM collection_items WHERE id=$1 AND owner_id=$2",
          [iid, ownerId],
        );
        if (item.rowCount)
          await c.query(
            "INSERT INTO artwork_revisions(id,item_id,input_version,media_id,provider,status,settings,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(item_id,input_version,provider) DO NOTHING",
            [
              sameOwner ? art.id : stable(ownerId, art.id),
              iid,
              art.input_version,
              mid,
              art.provider,
              art.status,
              art.settings ?? {},
              art.created_at ?? new Date(),
            ],
          );
      }
    });
    return { imported, skipped, recoveredMedia };
  }
}
