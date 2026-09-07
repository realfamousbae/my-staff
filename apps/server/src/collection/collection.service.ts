import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { DbService } from "../db/db.service";
import { iso } from "../common/http";
import { remember, replay } from "../common/idempotency";

type ItemRow = Record<string, any>;
const mapEdition = (r: any) =>
  r
    ? {
        id: r.id,
        productId: r.product_id,
        category: r.category,
        brand: r.brand,
        name: r.title,
        line: r.line,
        flavor: r.flavor,
        market: r.market,
        manufacturedIn: r.manufactured_in,
        quantity: r.quantity,
        design: r.design,
        series: r.series,
        barcodes: r.barcodes,
        evidence: r.evidence,
        status: r.status,
        mergedIntoId: r.merged_into_id,
        version: r.version,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      }
    : null;
export const mapMedia = (m: any) => ({
  id: m.id,
  itemId: m.item_id,
  role: m.role,
  mimeType: m.mime_type,
  byteSize: Number(m.byte_size),
  sha256: m.sha256,
  status: m.state === "confirmed" ? "confirmed" : "pending",
  createdAt: iso(m.created_at),
});

@Injectable()
export class CollectionService {
  constructor(@Inject(DbService) private readonly db: DbService) {}
  private async find(
    client: PoolClient,
    ownerId: string,
    id: string,
    includeDeleted = false,
    lock = false,
  ) {
    const result = await client.query<ItemRow>(
      `SELECT i.*, e.id AS e_id,e.product_id AS e_product_id,e.category AS e_category,e.brand AS e_brand,e.title AS e_title,e.line AS e_line,e.flavor AS e_flavor,e.market AS e_market,e.manufactured_in AS e_manufactured_in,e.quantity AS e_quantity,e.design AS e_design,e.series AS e_series,e.barcodes AS e_barcodes,e.evidence AS e_evidence,e.status AS e_status,e.merged_into_id AS e_merged_into_id,e.version AS e_version,e.created_at AS e_created_at,e.updated_at AS e_updated_at FROM collection_items i LEFT JOIN editions e ON e.id=i.edition_id WHERE i.id=$1 AND i.owner_id=$2 ${includeDeleted ? "" : "AND i.deleted_at IS NULL"}${lock ? " FOR UPDATE OF i" : ""}`,
      [id, ownerId],
    );
    if (!result.rowCount)
      throw new NotFoundException({
        code: "ITEM_NOT_FOUND",
        message: "Collection item not found",
      });
    return result.rows[0];
  }
  private async present(client: PoolClient, row: ItemRow) {
    const media = (
      await client.query(
        "SELECT id,item_id,role,mime_type,byte_size,sha256,state,created_at FROM media_assets WHERE item_id=$1 AND (role<>'artwork' OR id=(SELECT media_id FROM artwork_revisions WHERE item_id=$1 AND input_version=$2 AND status='ready' ORDER BY created_at DESC LIMIT 1)) ORDER BY created_at",
        [row.id, row.input_revision],
      )
    ).rows.map(mapMedia);
    const candidates = (
      await client.query(
        "SELECT c.edition_id,c.confidence,coalesce(c.evidence->>'reason','') reason FROM recognition_candidates c JOIN recognition_attempts a ON a.id=c.attempt_id WHERE a.item_id=$1 AND a.input_version=$2 ORDER BY c.confidence DESC",
        [row.id, row.input_revision],
      )
    ).rows.map((x) => ({
      editionId: x.edition_id,
      confidence: Number(x.confidence),
      reason: x.reason,
    }));
    const e = row.e_id
      ? mapEdition({
          id: row.e_id,
          product_id: row.e_product_id,
          category: row.e_category,
          brand: row.e_brand,
          title: row.e_title,
          line: row.e_line,
          flavor: row.e_flavor,
          market: row.e_market,
          manufactured_in: row.e_manufactured_in,
          quantity: row.e_quantity,
          design: row.e_design,
          series: row.e_series,
          barcodes: row.e_barcodes,
          evidence: row.e_evidence,
          status: row.e_status,
          merged_into_id: row.e_merged_into_id,
          version: row.e_version,
          created_at: row.e_created_at,
          updated_at: row.e_updated_at,
        })
      : null;
    return {
      id: row.id,
      ownerId: row.owner_id,
      category: row.category,
      title: row.title,
      notes: row.notes,
      sessionId: row.capture_session_id,
      editionId: row.edition_id,
      edition: e,
      version: row.version,
      inputRevision: row.input_revision,
      capturedAt: iso(row.captured_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: iso(row.deleted_at),
      recognitionStatus: row.recognition_status,
      artworkStatus: row.presentation_status,
      media,
      candidates,
    };
  }
  async snapshot(client: PoolClient, ownerId: string, itemId: string) {
    return this.present(
      client,
      await this.find(client, ownerId, itemId, false),
    );
  }
  async list(ownerId: string, includeDeleted = false) {
    return this.db.tx(async (c) => {
      const rows = (
        await c.query<ItemRow>(
          `SELECT i.*, e.id AS e_id,e.product_id AS e_product_id,e.category AS e_category,e.brand AS e_brand,e.title AS e_title,e.line AS e_line,e.flavor AS e_flavor,e.market AS e_market,e.manufactured_in AS e_manufactured_in,e.quantity AS e_quantity,e.design AS e_design,e.series AS e_series,e.barcodes AS e_barcodes,e.evidence AS e_evidence,e.status AS e_status,e.merged_into_id AS e_merged_into_id,e.version AS e_version,e.created_at AS e_created_at,e.updated_at AS e_updated_at FROM collection_items i LEFT JOIN editions e ON e.id=i.edition_id WHERE i.owner_id=$1 ${includeDeleted ? "" : "AND i.deleted_at IS NULL"} ORDER BY i.created_at DESC`,
          [ownerId],
        )
      ).rows;
      return { items: await Promise.all(rows.map((x) => this.present(c, x))) };
    });
  }
  async create(ownerId: string, id: string, input: any) {
    return this.db.tx(async (c) => {
      const prior = await replay<any>(
        c,
        ownerId,
        input.operationId,
        "create_item",
        { id, input },
      );
      if (prior) return prior;
      const exists = await c.query<ItemRow>(
        "SELECT * FROM collection_items WHERE id=$1",
        [id],
      );
      if (exists.rowCount) {
        if (exists.rows[0].owner_id !== ownerId)
          throw new ForbiddenException({
            code: "ITEM_OWNED_BY_ANOTHER_USER",
            message: "Item id belongs to another user",
          });
        const out = await this.present(
          c,
          await this.find(c, ownerId, id, true),
        );
        await remember(
          c,
          ownerId,
          input.operationId,
          "create_item",
          { id, input },
          out,
        );
        return out;
      }
      if (input.sessionId) {
        await c.query(
          "INSERT INTO capture_sessions(id,owner_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [input.sessionId, ownerId],
        );
        const session = await c.query(
          "SELECT 1 FROM capture_sessions WHERE id=$1 AND owner_id=$2",
          [input.sessionId, ownerId],
        );
        if (!session.rowCount)
          throw new ForbiddenException({
            code: "SESSION_OWNED_BY_ANOTHER_USER",
            message: "Capture session belongs to another user",
          });
      }
      const r = await c.query<ItemRow>(
        "INSERT INTO collection_items(id,owner_id,category,title,notes,capture_session_id,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          id,
          ownerId,
          input.category,
          input.title,
          input.notes,
          input.sessionId,
          input.capturedAt,
        ],
      );
      const out = await this.present(c, r.rows[0]);
      await c.query(
        "INSERT INTO item_revisions(id,item_id,author_id,operation_id,version,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), id, ownerId, input.operationId, 1, out],
      );
      await remember(
        c,
        ownerId,
        input.operationId,
        "create_item",
        { id, input },
        out,
      );
      return out;
    });
  }
  async patch(ownerId: string, id: string, input: any) {
    return this.db.tx(async (c) => {
      const prior = await replay<any>(
        c,
        ownerId,
        input.operationId,
        "patch_item",
        { id, input },
      );
      if (prior) return prior;
      const current = await this.find(c, ownerId, id, true, true);
      if (current.version !== input.expectedVersion)
        throw new ConflictException({
          code: "VERSION_CONFLICT",
          message: "Item changed on another device",
          current: await this.present(c, current),
        });
      if (input.editionId) {
        const edition = await c.query(
          "SELECT category FROM editions WHERE id=$1 AND (status='confirmed' OR (status='draft' AND created_by=$2))",
          [input.editionId, ownerId],
        );
        if (!edition.rowCount)
          throw new NotFoundException({
            code: "EDITION_NOT_FOUND",
            message: "Edition not found",
          });
        if (edition.rows[0].category !== (input.category ?? current.category))
          throw new ConflictException({
            code: "CATEGORY_MISMATCH",
            message: "Издание относится к другой категории",
          });
      } else if (
        input.category &&
        input.category !== current.category &&
        current.edition_id &&
        !Object.hasOwn(input, "editionId")
      )
        throw new ConflictException({
          code: "CATEGORY_MISMATCH",
          message: "Сначала отвяжите издание другой категории",
        });
      const updated = await c.query<ItemRow>(
        "UPDATE collection_items SET category=COALESCE($3,category),title=COALESCE($4,title),notes=COALESCE($5,notes),edition_id=CASE WHEN $6 THEN $7::uuid ELSE edition_id END,recognition_status=CASE WHEN $6 THEN CASE WHEN $7::uuid IS NOT NULL THEN 'confirmed' ELSE 'unassigned' END ELSE recognition_status END,deleted_at=CASE WHEN $8::boolean IS NULL THEN deleted_at WHEN $8 THEN COALESCE(deleted_at,now()) ELSE NULL END,version=version+1,input_revision=input_revision+CASE WHEN (category IS DISTINCT FROM COALESCE($3,category)) OR ($6 AND edition_id IS DISTINCT FROM $7::uuid) THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
        [
          id,
          ownerId,
          input.category ?? null,
          input.title ?? null,
          input.notes ?? null,
          Object.hasOwn(input, "editionId"),
          input.editionId ?? null,
          input.deleted ?? null,
        ],
      );
      const out = await this.present(c, updated.rows[0]);
      await c.query(
        "INSERT INTO item_revisions(id,item_id,author_id,operation_id,version,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), id, ownerId, input.operationId, out.version, out],
      );
      await remember(
        c,
        ownerId,
        input.operationId,
        "patch_item",
        { id, input },
        out,
      );
      return out;
    });
  }
  async owned(ownerId: string, id: string) {
    return this.db.tx((c) => this.find(c, ownerId, id));
  }
}
