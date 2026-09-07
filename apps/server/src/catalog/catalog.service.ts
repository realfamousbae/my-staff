import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DbService } from "../db/db.service";
import { iso } from "../common/http";
import { remember, replay } from "../common/idempotency";
const map = (r: any) => ({
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
});
@Injectable()
export class CatalogService {
  constructor(@Inject(DbService) private readonly db: DbService) {}
  private editor(user: any) {
    if (user.role !== "editor")
      throw new ForbiddenException({
        code: "EDITOR_ROLE_REQUIRED",
        message: "Catalog changes require editor role",
      });
  }
  async list(user: any, q?: string, category?: string) {
    const v: any[] = [user.id];
    let where = "(status='confirmed' OR (status='draft' AND created_by=$1))";
    if (category) {
      v.push(category);
      where += ` AND category=$${v.length}`;
    }
    if (q) {
      v.push(`%${q}%`);
      where += ` AND (title ILIKE $${v.length} OR brand ILIKE $${v.length} OR coalesce(flavor,'') ILIKE $${v.length} OR coalesce(design,'') ILIKE $${v.length} OR coalesce(market,'') ILIKE $${v.length} OR barcodes::text ILIKE $${v.length})`;
    }
    return {
      editions: (
        await this.db.query(
          `SELECT * FROM editions WHERE ${where} ORDER BY title LIMIT 1000`,
          v,
        )
      ).rows.map(map),
    };
  }
  async propose(user: any, input: any) {
    return this.db.tx(async (c) => {
      const old = await replay<any>(
        c,
        user.id,
        input.operationId,
        "edition_create",
        input,
      );
      if (old) return old;
      const productId = randomUUID(),
        id = randomUUID();
      await c.query(
        "INSERT INTO products(id,category,brand,line,flavor,title,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          productId,
          input.category,
          input.brand,
          input.line,
          input.flavor,
          input.name,
          user.id,
        ],
      );
      const row = (
        await c.query(
          "INSERT INTO editions(id,product_id,category,title,brand,line,flavor,market,manufactured_in,quantity,design,series,barcodes,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
          [
            id,
            productId,
            input.category,
            input.name,
            input.brand,
            input.line,
            input.flavor,
            input.market,
            input.manufacturedIn,
            input.quantity,
            input.design,
            input.series,
            JSON.stringify(input.barcodes),
            input.evidence,
            user.id,
          ],
        )
      ).rows[0];
      const out = { edition: map(row) };
      await c.query(
        "INSERT INTO edition_revisions(id,edition_id,author_id,operation,after_data) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), id, user.id, "proposed", row],
      );
      await remember(
        c,
        user.id,
        input.operationId,
        "edition_create",
        input,
        out,
      );
      return out;
    });
  }
  async confirm(user: any, id: string, input: any) {
    this.editor(user);
    return this.db.tx(async (c) => {
      const old = await replay<any>(
        c,
        user.id,
        input.operationId,
        "edition_confirm",
        { id, input },
      );
      if (old) return old;
      const current = (
        await c.query("SELECT * FROM editions WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!current || current.status !== "draft")
        throw new NotFoundException({
          code: "DRAFT_EDITION_NOT_FOUND",
          message: "Draft edition not found",
        });
      if (current.version !== input.expectedVersion)
        throw new ConflictException({
          code: "VERSION_CONFLICT",
          message: "Edition changed",
          current: map(current),
        });
      const row = (
        await c.query(
          "UPDATE editions SET status='confirmed',confirmed_by=$2,confirmed_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, user.id],
        )
      ).rows[0];
      const out = { edition: map(row) };
      await c.query(
        "INSERT INTO edition_revisions(id,edition_id,author_id,operation,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), id, user.id, "confirmed", current, row],
      );
      await remember(
        c,
        user.id,
        input.operationId,
        "edition_confirm",
        { id, input },
        out,
      );
      return out;
    });
  }
  async merge(user: any, id: string, input: any) {
    this.editor(user);
    return this.db.tx(async (c) => {
      const old = await replay<any>(
        c,
        user.id,
        input.operationId,
        "edition_merge",
        { id, input },
      );
      if (old) return old;
      if (id === input.targetId)
        throw new ConflictException({
          code: "INVALID_MERGE",
          message: "Cannot merge an edition into itself",
        });
      const locked = (
          await c.query(
            "SELECT * FROM editions WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [[id, input.targetId]],
          )
        ).rows,
        source = locked.find((x) => x.id === id),
        target = locked.find((x) => x.id === input.targetId);
      if (
        !source ||
        !target ||
        !["draft", "confirmed"].includes(source.status) ||
        target.status !== "confirmed" ||
        source.category !== target.category
      )
        throw new NotFoundException({
          code: "EDITION_NOT_MERGEABLE",
          message: "Source and target must be same-category active editions",
        });
      if (source.version !== input.expectedVersion)
        throw new ConflictException({
          code: "VERSION_CONFLICT",
          message: "Edition changed",
          current: map(source),
        });
      const row = (
        await c.query(
          "UPDATE editions SET status='merged',merged_into_id=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, input.targetId],
        )
      ).rows[0];
      await c.query(
        "UPDATE collection_items SET edition_id=$2,input_revision=input_revision+1,version=version+1,updated_at=now() WHERE edition_id=$1",
        [id, input.targetId],
      );
      await c.query(
        "INSERT INTO edition_revisions(id,edition_id,author_id,operation,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          id,
          user.id,
          "merged",
          source,
          { ...row, reason: input.reason },
        ],
      );
      const out = { edition: map(row) };
      await remember(
        c,
        user.id,
        input.operationId,
        "edition_merge",
        { id, input },
        out,
      );
      return out;
    });
  }
}
