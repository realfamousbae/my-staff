import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import type { PgBoss } from "pg-boss";
import type { Item, Edition } from "@my-staff/contracts";
import { DbService } from "../db/db.service";
import { CollectionService } from "../collection/collection.service";
import { StorageService } from "../storage/storage.service";
import { replay, remember } from "../common/idempotency";
import {
  providers,
  type ProcessingInput,
  type RecognitionResult,
  type UnknownResult,
} from "./providers";

export type ProcessingPayload = {
  itemId: string;
  inputVersion: number;
  recognitionProvider: string;
  artworkProvider: string;
};
type Claim = { token: string; item: Record<string, any> };

@Injectable()
export class ProcessingService {
  private readonly provider = providers();
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CollectionService) private readonly items: CollectionService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async request(
    ownerId: string,
    itemId: string,
    operationId: string,
  ): Promise<Item> {
    return this.db.tx(async (client) => {
      const body = { itemId };
      const previous = await replay<Item>(
        client,
        ownerId,
        operationId,
        "process_item",
        body,
      );
      if (previous) return previous;
      const row = await client.query(
        "SELECT * FROM collection_items WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [itemId, ownerId],
      );
      if (!row.rowCount) throw new NotFoundException("Предмет не найден");
      const media = await client.query(
        "SELECT id FROM media_assets WHERE item_id=$1 AND state='confirmed' AND role='original'",
        [itemId],
      );
      if (!media.rowCount)
        throw new ConflictException({
          code: "ORIGINAL_MEDIA_REQUIRED",
          message: "Сначала отправьте оригинал",
        });
      const payload: ProcessingPayload = {
        itemId,
        inputVersion: row.rows[0].input_revision,
        recognitionProvider: this.provider.recognition.name,
        artworkProvider: this.provider.artwork.name,
      };
      const key = [
        itemId,
        payload.inputVersion,
        payload.recognitionProvider,
        payload.artworkProvider,
      ].join(":");
      const inserted = await client.query(
        "INSERT INTO processing_outbox(id,kind,payload,dedupe_key) VALUES($1,'process_item',$2,$3) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id",
        [randomUUID(), payload, key],
      );
      // Reuse successful stages. An uncertain paid call must never be repeated
      // merely because a client retries the processing operation.
      const resumed = inserted.rowCount
        ? null
        : await client.query(
            "UPDATE processing_outbox o SET state='pending',attempts=0,available_at=now(),finished_at=NULL,last_error=NULL,worker_token=NULL,lease_until=NULL WHERE dedupe_key=$1 AND state IN ('failed','outcome_unknown') AND NOT EXISTS (SELECT 1 FROM provider_calls p WHERE p.request_key IN (o.id::text||':recognition',o.id::text||':artwork') AND p.state IN ('started','outcome_unknown')) RETURNING id",
            [key],
          );
      if (inserted.rowCount || resumed?.rowCount)
        await client.query(
          "UPDATE collection_items SET recognition_status=CASE WHEN edition_id IS NULL THEN 'pending' ELSE 'confirmed' END,presentation_status='pending',version=version+1,updated_at=now() WHERE id=$1",
          [itemId],
        );
      const result = (await this.items.snapshot(
        client,
        ownerId,
        itemId,
      )) as Item;
      await remember(
        client,
        ownerId,
        operationId,
        "process_item",
        body,
        result,
      );
      return result;
    });
  }

  /** Dispatch and outbox acknowledgement use one database transaction. */
  async dispatch(boss: PgBoss) {
    return this.db.tx(async (client) => {
      const rows = await client.query(
        "SELECT * FROM processing_outbox WHERE (state='pending' AND available_at<=now()) OR (state='running' AND lease_until<now()) OR (state='dispatched' AND dispatched_at<now()-interval '20 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10",
      );
      for (const row of rows.rows) {
        await boss.send(
          "process-item",
          { outboxId: row.id, payload: row.payload },
          {
            singletonKey: row.id,
            retryLimit: 3,
            retryDelay: 5,
            retryBackoff: true,
            expireInSeconds: 900,
            db: {
              executeSql: (sql, parameters) => client.query(sql, parameters),
            },
          },
        );
        await client.query(
          "UPDATE processing_outbox SET state='dispatched',dispatched_at=now() WHERE id=$1",
          [row.id],
        );
      }
      return rows.rowCount ?? 0;
    });
  }

  private async claim(
    id: string,
    payload: ProcessingPayload,
  ): Promise<Claim | null> {
    return this.db.tx(async (client) => {
      const job = await client.query(
        "SELECT * FROM processing_outbox WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (
        !job.rowCount ||
        ["done", "failed", "outcome_unknown"].includes(job.rows[0].state)
      )
        return null;
      if (
        job.rows[0].state === "running" &&
        new Date(job.rows[0].lease_until).getTime() > Date.now()
      )
        return null;
      const item = (
        await client.query(
          "SELECT * FROM collection_items WHERE id=$1 FOR UPDATE",
          [payload.itemId],
        )
      ).rows[0];
      if (
        !item ||
        item.deleted_at ||
        item.input_revision !== payload.inputVersion
      ) {
        await client.query(
          "UPDATE processing_outbox SET state='done',finished_at=now(),last_error='Superseded input' WHERE id=$1",
          [id],
        );
        return null;
      }
      if (
        payload.recognitionProvider !== this.provider.recognition.name ||
        payload.artworkProvider !== this.provider.artwork.name
      ) {
        await client.query(
          "UPDATE processing_outbox SET state='failed',finished_at=now(),last_error='Provider configuration changed; request processing again' WHERE id=$1",
          [id],
        );
        await client.query(
          "UPDATE collection_items SET recognition_status=CASE WHEN edition_id IS NULL THEN 'failed' ELSE 'confirmed' END,presentation_status='failed',version=version+1,updated_at=now() WHERE id=$1",
          [item.id],
        );
        return null;
      }
      const token = randomUUID();
      await client.query(
        "UPDATE processing_outbox SET state='running',worker_token=$2,lease_until=now()+interval '15 minutes',attempts=attempts+1 WHERE id=$1",
        [id, token],
      );
      await client.query(
        "UPDATE collection_items SET recognition_status=CASE WHEN edition_id IS NULL THEN 'processing' ELSE 'confirmed' END,presentation_status='processing',version=version+1,updated_at=now() WHERE id=$1",
        [item.id],
      );
      return { token, item };
    });
  }

  private async readInput(
    payload: ProcessingPayload,
    claim: Claim,
  ): Promise<ProcessingInput> {
    const files = await this.db.query(
      "SELECT id,mime_type FROM media_assets WHERE item_id=$1 AND state='confirmed' AND role IN ('original','detail') ORDER BY CASE WHEN role='original' THEN 0 ELSE 1 END,created_at LIMIT 4",
      [payload.itemId],
    );
    const media: ProcessingInput["media"] = [];
    for (const file of files.rows) {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of (await this.storage.read(
        file.id,
      )) as AsyncIterable<Buffer>) {
        length += chunk.length;
        if (length > 30 * 1024 * 1024)
          throw new Error("Image exceeds processing limit");
        chunks.push(Buffer.from(chunk));
      }
      media.push({
        id: file.id,
        mimeType: file.mime_type,
        bytes: Buffer.concat(chunks),
      });
    }
    if (!media.length) throw new Error("Original photo unavailable");
    const rows = await this.db.query(
      "SELECT * FROM editions WHERE category=$1 AND status='confirmed' ORDER BY updated_at DESC LIMIT 1001",
      [claim.item.category],
    );
    // The first catalogue comfortably holds the initial 645 objects. Beyond
    // this size, require a retrieval stage rather than silently ignore entries.
    if (rows.rows.length > 1000 && this.provider.recognition.external)
      throw new Error(
        "Catalogue requires a retrieval index before AI matching above 1000 editions",
      );
    const catalog = rows.rows.map((r) => ({
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
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    })) as Edition[];
    return { ...payload, category: claim.item.category, media, catalog };
  }

  private async reserve(
    key: string,
    payload: ProcessingPayload,
    stage: string,
    provider: string,
  ) {
    return this.db.tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ai-daily-budget',0))",
      );
      const existing = await client.query(
        "SELECT * FROM provider_calls WHERE request_key=$1",
        [key],
      );
      if (existing.rowCount) return existing.rows[0];
      const count = await client.query(
        "SELECT count(*)::int AS count FROM provider_calls WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')",
      );
      if (
        count.rows[0].count >= Number(process.env.AI_DAILY_REQUEST_LIMIT ?? 0)
      )
        return {
          state: "outcome_unknown",
          result: { reason: "Достигнут дневной лимит внешних запросов" },
        };
      await client.query(
        "INSERT INTO provider_calls(request_key,item_id,input_revision,stage,provider,state) VALUES($1,$2,$3,$4,$5,'started')",
        [key, payload.itemId, payload.inputVersion, stage, provider],
      );
      return null;
    });
  }

  private async saveCall(
    key: string,
    state: "succeeded" | "outcome_unknown",
    result: unknown,
  ) {
    await this.db.query(
      "UPDATE provider_calls SET state=$2,result=$3,finished_at=now() WHERE request_key=$1",
      [key, state, result],
    );
  }

  async complete(id: string, payload: ProcessingPayload) {
    const claim = await this.claim(id, payload);
    if (!claim) return;
    const input = await this.readInput(payload, claim);
    let recognized: RecognitionResult | UnknownResult = {
      kind: "result",
      candidates: [],
    };
    if (!claim.item.edition_id) {
      const key = id + ":recognition";
      const prior = this.provider.recognition.external
        ? await this.reserve(
            key,
            payload,
            "recognition",
            this.provider.recognition.name,
          )
        : null;
      recognized = prior
        ? prior.state === "succeeded"
          ? (prior.result as RecognitionResult)
          : {
              kind: "outcome_unknown",
              reason:
                prior.result?.reason ??
                "Исход предыдущего запроса не подтверждён",
            }
        : await this.provider.recognition.recognize(input);
      if (this.provider.recognition.external && !prior)
        await this.saveCall(
          key,
          recognized.kind === "result" ? "succeeded" : "outcome_unknown",
          recognized,
        );
    }
    await this.db.tx(async (client) => {
      const current = (
        await client.query(
          "SELECT * FROM collection_items WHERE id=$1 FOR UPDATE",
          [payload.itemId],
        )
      ).rows[0];
      if (
        !current ||
        current.deleted_at ||
        current.input_revision !== payload.inputVersion
      )
        return;
      const status =
        recognized.kind === "result"
          ? recognized.candidates.length
            ? "proposed"
            : "needs_review"
          : "outcome_unknown";
      const attempt = await client.query(
        "INSERT INTO recognition_attempts(id,item_id,input_version,status,provider,result,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,now(),now()) ON CONFLICT(item_id,input_version,provider) DO UPDATE SET result=excluded.result,status=excluded.status,finished_at=now() RETURNING id",
        [
          randomUUID(),
          payload.itemId,
          payload.inputVersion,
          status,
          this.provider.recognition.name,
          recognized,
        ],
      );
      await client.query(
        "DELETE FROM recognition_candidates WHERE attempt_id=$1",
        [attempt.rows[0].id],
      );
      if (recognized.kind === "result")
        for (const candidate of recognized.candidates)
          await client.query(
            "INSERT INTO recognition_candidates(id,attempt_id,edition_id,confidence,evidence) SELECT $1,$2,id,$4,$5 FROM editions WHERE id=$3 AND status='confirmed'",
            [
              randomUUID(),
              attempt.rows[0].id,
              candidate.editionId,
              candidate.confidence,
              { reason: candidate.reason },
            ],
          );
      await client.query(
        "UPDATE collection_items SET recognition_status=CASE WHEN edition_id IS NULL THEN $2 ELSE 'confirmed' END,version=version+1,updated_at=now() WHERE id=$1",
        [payload.itemId, status],
      );
    });
    const current = await this.db.query(
      "SELECT 1 FROM collection_items WHERE id=$1 AND input_revision=$2 AND deleted_at IS NULL",
      [payload.itemId, payload.inputVersion],
    );
    if (!current.rowCount) {
      await this.finish(id, claim.token);
      return;
    }
    const key = id + ":artwork";
    const prior = this.provider.artwork.external
      ? await this.reserve(key, payload, "artwork", this.provider.artwork.name)
      : null;
    let mediaId = input.media[0].id;
    let settings: Record<string, unknown> = { mode: "original-photo" };
    let unknown: string | null = null;
    if (prior) {
      if (prior.state === "succeeded") {
        mediaId = prior.result.mediaId;
        settings = prior.result.settings;
      } else
        unknown =
          prior.result?.reason ?? "Исход предыдущего оформления не подтверждён";
    } else {
      const artwork = await this.provider.artwork.render(input);
      if (artwork.kind === "outcome_unknown") unknown = artwork.reason;
      else {
        settings = artwork.settings ?? {};
        if (this.provider.artwork.external) {
          mediaId = randomUUID();
          await this.storage.writeImmutable(
            mediaId,
            artwork.bytes,
            artwork.mimeType,
          );
          await this.db.tx(async (client) => {
            await client.query(
              "INSERT INTO media_assets(id,owner_id,item_id,role,mime_type,byte_size,sha256,object_key,state,immutable_at,confirmed_at) VALUES($1,$2,$3,'artwork',$4,$5,$6,$7,'confirmed',now(),now())",
              [
                mediaId,
                claim.item.owner_id,
                payload.itemId,
                artwork.mimeType,
                artwork.bytes.length,
                createHash("sha256").update(artwork.bytes).digest("hex"),
                "originals/" + mediaId,
              ],
            );
            await client.query(
              "UPDATE provider_calls SET state='succeeded',result=$2,finished_at=now() WHERE request_key=$1",
              [key, { mediaId, settings, usage: artwork.usage }],
            );
          });
        }
      }
      if (this.provider.artwork.external && unknown)
        await this.saveCall(key, "outcome_unknown", { reason: unknown });
    }
    await this.db.tx(async (client) => {
      const item = (
        await client.query(
          "SELECT * FROM collection_items WHERE id=$1 FOR UPDATE",
          [payload.itemId],
        )
      ).rows[0];
      if (
        item &&
        !item.deleted_at &&
        item.input_revision === payload.inputVersion
      ) {
        if (!unknown)
          await client.query(
            "INSERT INTO artwork_revisions(id,item_id,input_version,media_id,provider,status,settings) VALUES($1,$2,$3,$4,$5,'ready',$6) ON CONFLICT(item_id,input_version,provider) DO NOTHING",
            [
              randomUUID(),
              payload.itemId,
              payload.inputVersion,
              mediaId,
              this.provider.artwork.name,
              settings,
            ],
          );
        await client.query(
          "UPDATE collection_items SET presentation_status=$2,version=version+1,updated_at=now() WHERE id=$1",
          [payload.itemId, unknown ? "outcome_unknown" : "ready"],
        );
      }
      await client.query(
        "UPDATE processing_outbox SET state=$3,last_error=$4,finished_at=now(),lease_until=NULL WHERE id=$1 AND worker_token=$2",
        [
          id,
          claim.token,
          unknown || recognized.kind === "outcome_unknown"
            ? "outcome_unknown"
            : "done",
          unknown ??
            (recognized.kind === "outcome_unknown" ? recognized.reason : null),
        ],
      );
    });
  }

  private async finish(id: string, token: string) {
    await this.db.query(
      "UPDATE processing_outbox SET state='done',finished_at=now(),lease_until=NULL WHERE id=$1 AND worker_token=$2",
      [id, token],
    );
  }

  async fail(id: string, error: unknown) {
    await this.db.tx(async (client) => {
      const updated = await client.query(
        "UPDATE processing_outbox SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,last_error=$2,available_at=now()+interval '30 seconds',lease_until=NULL WHERE id=$1 AND state NOT IN ('done','outcome_unknown') RETURNING *",
        [
          id,
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Processing failed",
        ],
      );
      if (updated.rows[0]?.state === "failed") {
        const payload = updated.rows[0].payload as ProcessingPayload;
        await client.query(
          "UPDATE collection_items SET recognition_status=CASE WHEN edition_id IS NULL AND recognition_status IN ('pending','processing') THEN 'failed' ELSE recognition_status END,presentation_status='failed',version=version+1,updated_at=now() WHERE id=$1 AND input_revision=$2 AND deleted_at IS NULL",
          [payload.itemId, payload.inputVersion],
        );
      }
    });
  }
}
