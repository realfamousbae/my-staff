import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { AuthService } from "../src/auth/auth.service";
import { CollectionService } from "../src/collection/collection.service";
import { DbService } from "../src/db/db.service";
import {
  ProcessingService,
  type ProcessingPayload,
} from "../src/processing/processing.service";
import { StorageService } from "../src/storage/storage.service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname))
  throw new Error("A loopback TEST_DATABASE_URL is required");
const schema = "test_" + randomUUID().replaceAll("-", "");
const bossSchema = schema + "_boss";
process.env.DATABASE_URL = url;
process.env.PGOPTIONS = `-c search_path=${schema},public`;
process.env.AI_ENABLED = "false";
process.env.STORAGE_DRIVER = "local";
let directory: string;
let db: DbService,
  storage: StorageService,
  items: CollectionService,
  processing: ProcessingService,
  boss: PgBoss;
const admin = new Pool({ connectionString: url });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "collection-processing-"));
  process.env.LOCAL_STORAGE_DIR = directory;
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new DbService();
  storage = new StorageService();
  items = new CollectionService(db);
  processing = new ProcessingService(db, items, storage);
  for (const file of [
    "001_initial.sql",
    "002_idempotency.sql",
    "003_processing.sql",
  ])
    await db.query(
      await readFile(
        join(process.cwd(), "apps/server/migrations", file),
        "utf8",
      ),
    );
  boss = new PgBoss({ connectionString: url, schema: bossSchema });
  await boss.start();
  await boss.createQueue("process-item");
});
beforeEach(async () => {
  await db.query("TRUNCATE users,processing_outbox CASCADE");
});
afterAll(async () => {
  await boss?.stop();
  await db?.onModuleDestroy();
  await admin.query(`DROP SCHEMA IF EXISTS ${bossSchema} CASCADE`);
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const user = (
    await new AuthService(db).register(
      `${randomUUID()}@example.test`,
      "local test password",
    )
  ).user;
  const item = await items.create(user.id, randomUUID(), {
    operationId: randomUUID(),
    category: "energy",
    title: "Test",
    notes: "",
    sessionId: null,
    capturedAt: new Date().toISOString(),
  });
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=",
    "base64",
  );
  const mediaId = randomUUID();
  await storage.writeImmutable(mediaId, bytes, "image/png");
  await db.query(
    "INSERT INTO media_assets(id,owner_id,item_id,role,mime_type,byte_size,sha256,object_key,state,confirmed_at,immutable_at) VALUES($1,$2,$3,'original','image/png',$4,$5,$6,'confirmed',now(),now())",
    [
      mediaId,
      user.id,
      item.id,
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
      "originals/" + mediaId,
    ],
  );
  await processing.request(user.id, item.id, randomUUID());
  const job = (
    await db.query(
      "SELECT * FROM processing_outbox WHERE payload->>'itemId'=$1",
      [item.id],
    )
  ).rows[0];
  return { user, item, job, mediaId };
}

describe("durable processing with PostgreSQL", () => {
  it("dispatches through real pg-boss and preserves original artwork without external calls", async () => {
    const { user, item, mediaId } = await fixture();
    expect(await processing.dispatch(boss)).toBe(1);
    const jobs = await boss.fetch<{
      outboxId: string;
      payload: ProcessingPayload;
    }>("process-item");
    expect(jobs).toHaveLength(1);
    await processing.complete(jobs[0].data.outboxId, jobs[0].data.payload);
    await boss.complete("process-item", jobs[0].id);
    const snapshot = await db.tx((client) =>
      items.snapshot(client, user.id, item.id),
    );
    expect(snapshot.recognitionStatus).toBe("needs_review");
    expect(snapshot.artworkStatus).toBe("ready");
    expect(
      (await db.query("SELECT media_id FROM artwork_revisions")).rows[0]
        .media_id,
    ).toBe(mediaId);
    expect((await db.query("SELECT * FROM provider_calls")).rowCount).toBe(0);
    await processing.request(user.id, item.id, randomUUID());
    expect((await db.query("SELECT * FROM processing_outbox")).rowCount).toBe(
      1,
    );
    expect(
      (await db.query("SELECT state FROM processing_outbox")).rows[0].state,
    ).toBe("done");
  });
  it("rolls back queue insertion and dispatch acknowledgement together", async () => {
    const { job } = await fixture();
    const failingBoss = {
      send: async (_name: string, _data: unknown, options: any) => {
        await options.db.executeSql(
          "UPDATE processing_outbox SET attempts=99 WHERE id=$1",
          [job.id],
        );
        throw new Error("Simulated queue failure");
      },
    } as unknown as PgBoss;
    await expect(processing.dispatch(failingBoss)).rejects.toThrow(
      "Simulated queue failure",
    );
    expect(
      (
        await db.query(
          "SELECT state,attempts FROM processing_outbox WHERE id=$1",
          [job.id],
        )
      ).rows[0],
    ).toEqual({ state: "pending", attempts: 0 });
  });
  it("discards superseded photos before publishing any result", async () => {
    const { item, job } = await fixture();
    await db.query(
      "UPDATE collection_items SET input_revision=input_revision+1 WHERE id=$1",
      [item.id],
    );
    await processing.complete(job.id, job.payload);
    expect((await db.query("SELECT * FROM artwork_revisions")).rowCount).toBe(
      0,
    );
    expect(
      (await db.query("SELECT state FROM processing_outbox")).rows[0].state,
    ).toBe("done");
  });
  it("reopens recoverable failures but never repeats a paid call with uncertain outcome", async () => {
    const { user, item, job } = await fixture();
    await db.query(
      "UPDATE processing_outbox SET state='failed',attempts=3 WHERE id=$1",
      [job.id],
    );
    await processing.request(user.id, item.id, randomUUID());
    expect(
      (await db.query("SELECT state,attempts FROM processing_outbox")).rows[0],
    ).toEqual({ state: "pending", attempts: 0 });
    await db.query(
      "UPDATE processing_outbox SET state='outcome_unknown' WHERE id=$1",
      [job.id],
    );
    await db.query(
      "INSERT INTO provider_calls(request_key,item_id,input_revision,stage,provider,state) VALUES($1,$2,$3,'artwork','test-provider','started')",
      [job.id + ":artwork", item.id, job.payload.inputVersion],
    );
    await processing.request(user.id, item.id, randomUUID());
    expect(
      (await db.query("SELECT state FROM processing_outbox")).rows[0].state,
    ).toBe("outcome_unknown");
  });
  it("ends tasks created with an obsolete provider configuration", async () => {
    const { job } = await fixture();
    await processing.complete(job.id, {
      ...job.payload,
      artworkProvider: "old-provider",
    });
    expect(
      (await db.query("SELECT state FROM processing_outbox")).rows[0].state,
    ).toBe("failed");
  });
});
