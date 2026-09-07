import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { raw } from "express";
import { AppModule } from "../src/app.module";
import { DbService } from "../src/db/db.service";
import { AuthService } from "../src/auth/auth.service";
import { CollectionService } from "../src/collection/collection.service";
import { StorageService } from "../src/storage/storage.service";
import { MediaService } from "../src/media/media.service";
import { CatalogService } from "../src/catalog/catalog.service";
import { ExportService } from "../src/export/export.service";
import { ProcessingService } from "../src/processing/processing.service";
import { itemSchema, mediaSchema } from "@my-staff/contracts";
import { zipSync } from "fflate";

const testUrl = process.env.TEST_DATABASE_URL;
const testHost = testUrl ? new URL(testUrl).hostname : "";
if (!testUrl || !["127.0.0.1", "localhost", "::1"].includes(testHost))
  throw new Error(
    "TEST_DATABASE_URL must point to a loopback PostgreSQL test database",
  );
const schema = `test_${randomUUID().replaceAll("-", "")}`;
process.env.DATABASE_URL = testUrl;
process.env.PGOPTIONS = `-c search_path=${schema},public`;
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = "/tmp/my-staff-server-test-storage";
const db = new DbService(),
  auth = new AuthService(db),
  items = new CollectionService(db),
  storage = new StorageService(),
  media = new MediaService(db, storage, items),
  catalog = new CatalogService(db),
  archive = new ExportService(db, storage);
const processing = new ProcessingService(db, items, storage);
const input = (operationId = randomUUID()) => ({
  operationId,
  category: "energy" as const,
  title: "Test can",
  notes: "",
  sessionId: randomUUID(),
  capturedAt: "2026-09-05T12:00:00.000Z",
});
const contentText = async (ownerId: string, id: string) => {
  const chunks: Buffer[] = [];
  for await (const x of (await media.content(ownerId, id)).stream)
    chunks.push(Buffer.from(x));
  return Buffer.concat(chunks).toString();
};
const binaryParser = (response: any, done: any) => {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => done(null, Buffer.concat(chunks)));
};
const admin = new Pool({ connectionString: testUrl });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
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
});
afterAll(async () => {
  await db.onModuleDestroy();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await db.query("TRUNCATE users CASCADE");
});
describe("postgres integration", () => {
  it("auth, idempotent item ownership and optimistic version work", async () => {
    const a = await auth.register("a@example.test", "this is a valid password");
    expect((await auth.userFromToken(a.token)).email).toBe("a@example.test");
    const id = randomUUID(),
      request = input();
    const [one, two] = await Promise.all([
      items.create(a.user.id, id, request),
      items.create(a.user.id, id, request),
    ]);
    expect(one.id).toBe(two.id);
    expect(itemSchema.safeParse(one).success).toBe(true);
    await expect(
      items.create(a.user.id, id, { ...request, title: "changed" }),
    ).rejects.toMatchObject({ status: 409 });
    const changed = await items.patch(a.user.id, id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      title: "Updated",
    });
    await expect(
      items.patch(a.user.id, id, {
        operationId: randomUUID(),
        expectedVersion: 1,
        title: "lost",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(changed.version).toBe(2);
    const b = await auth.register("b@example.test", "another valid password");
    await expect(
      db.tx((c) => items.snapshot(c, b.user.id, id)),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("media validates bytes, stays private, and export restore preserves original", async () => {
    const a = await auth.register(
      "media@example.test",
      "this is a valid password",
    );
    const item = await items.create(a.user.id, randomUUID(), input());
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+0d7lAAAAAElFTkSuQmCC",
      "base64",
    );
    const sha = createHash("sha256").update(bytes).digest("hex"),
      mediaId = randomUUID();
    const ticket = await media.create(a.user.id, item.id, {
      id: mediaId,
      operationId: randomUUID(),
      role: "original",
      mimeType: "image/png",
      byteSize: bytes.length,
      sha256: sha,
    });
    expect(mediaSchema.safeParse(ticket.media).success).toBe(true);
    await media.upload(a.user.id, mediaId, Readable.from(bytes));
    const confirmed = await media.confirm(a.user.id, mediaId, randomUUID());
    expect(confirmed.media.status).toBe("confirmed");
    await expect(
      media.upload(a.user.id, mediaId, Readable.from(bytes)),
    ).rejects.toMatchObject({ status: 404 });
    const zip = await archive.create(a.user.id);
    const b = await auth.register(
      "restore@example.test",
      "another valid password",
    );
    expect((await archive.restore(b.user.id, zip)).imported).toBe(1);
    const restored = (await items.list(b.user.id)).items[0];
    expect(await contentText(b.user.id, restored.media[0].id)).toEqual(
      bytes.toString(),
    );
  });
  it("catalog confirms and merges while retaining item relation", async () => {
    const editor = await auth.register(
      "editor@example.test",
      "this is a valid password",
    );
    await db.query("UPDATE users SET role='editor' WHERE id=$1", [
      editor.user.id,
    ]);
    const e = await auth.userFromToken(editor.token);
    const create = (name: string) =>
      catalog.propose(e, {
        operationId: randomUUID(),
        category: "energy",
        brand: "Brand",
        name,
        line: null,
        flavor: null,
        market: null,
        manufacturedIn: null,
        quantity: null,
        design: null,
        series: null,
        barcodes: [],
        evidence: "",
      });
    const first = (await create("A")).edition,
      second = (await create("B")).edition;
    await catalog.confirm(e, first.id, {
      operationId: randomUUID(),
      expectedVersion: first.version,
    });
    await catalog.confirm(e, second.id, {
      operationId: randomUUID(),
      expectedVersion: second.version,
    });
    const merged = await catalog.merge(e, second.id, {
      operationId: randomUUID(),
      expectedVersion: 2,
      targetId: first.id,
      reason: "duplicate",
    });
    expect(merged.edition.mergedIntoId).toBe(first.id);
  });
  it("default manual processing creates one durable outbox job and no provider calls", async () => {
    const a = await auth.register(
      "process@example.test",
      "this is a valid password",
    );
    const item = await items.create(a.user.id, randomUUID(), input());
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+0d7lAAAAAElFTkSuQmCC",
      "base64",
    );
    const mediaId = randomUUID();
    await media.create(a.user.id, item.id, {
      id: mediaId,
      operationId: randomUUID(),
      role: "original",
      mimeType: "image/png",
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await media.upload(a.user.id, mediaId, Readable.from(bytes));
    await media.confirm(a.user.id, mediaId, randomUUID());
    const first = await processing.request(a.user.id, item.id, randomUUID());
    const second = await processing.request(a.user.id, item.id, randomUUID());
    expect(first.recognitionStatus).toBe("pending");
    expect(second.recognitionStatus).toBe("pending");
    expect((await db.query("SELECT * FROM processing_outbox")).rowCount).toBe(
      1,
    );
    expect((await db.query("SELECT * FROM provider_calls")).rowCount).toBe(0);
  });
  it("local storage confirmation is crash-retry safe after immutable promotion", async () => {
    const id = randomUUID(),
      bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+0d7lAAAAAElFTkSuQmCC",
        "base64",
      ),
      hash = createHash("sha256").update(bytes).digest("hex");
    await storage.writePending(id, Readable.from(bytes));
    expect(
      (await storage.confirm(id, bytes.length, hash, "image/png")).sha256,
    ).toBe(hash);
    expect(
      (await storage.confirm(id, bytes.length, hash, "image/png")).sha256,
    ).toBe(hash);
  });
  it("S3 staging checksum mismatch rejects before immutable copy", async () => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+0d7lAAAAAElFTkSuQmCC",
      "base64",
    );
    const previous = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_BUCKET = "test";
    const s3storage: any = new StorageService();
    let copied = false;
    s3storage.s3 = {
      send: async (command: any) => {
        if (
          command.constructor.name === "HeadObjectCommand" &&
          command.input.Key.startsWith("pending/")
        )
          return {
            ContentLength: bytes.length,
            VersionId: "v1",
            ETag: '"etag"',
          };
        if (command.constructor.name === "GetObjectCommand")
          return { Body: Readable.from(bytes) };
        if (command.constructor.name === "HeadObjectCommand") {
          const error: any = new Error("not found");
          error.name = "NotFound";
          throw error;
        }
        if (command.constructor.name === "CopyObjectCommand") {
          copied = true;
          return {};
        }
        return {};
      },
    };
    await expect(
      s3storage.confirm(
        randomUUID(),
        bytes.length,
        "0".repeat(64),
        "image/png",
      ),
    ).rejects.toThrow("checksum");
    expect(copied).toBe(false);
    process.env.STORAGE_DRIVER = previous;
  });
  it("HTTP Nest routes resolve DI and complete authenticated capture/export flow", async () => {
    process.env.STORAGE_DRIVER = "local";
    const app = await NestFactory.create(AppModule, { logger: false });
    app.use("/v1/import", raw({ type: "application/zip" }));
    app.setGlobalPrefix("v1");
    await app.init();
    try {
      const api = request(app.getHttpServer()),
        password = "this is a valid password";
      const registered = await api
        .post("/v1/auth/register")
        .send({ email: "http@example.test", password })
        .expect(201);
      const token = registered.body.token;
      await api
        .get("/v1/auth/me")
        .set("authorization", `Bearer ${token}`)
        .expect(200);
      const itemId = randomUUID(),
        op = randomUUID();
      await api
        .put(`/v1/items/${itemId}`)
        .set("authorization", `Bearer ${token}`)
        .send({ ...input(op), sessionId: randomUUID() })
        .expect(200);
      const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+0d7lAAAAAElFTkSuQmCC",
          "base64",
        ),
        mediaId = randomUUID(),
        hash = createHash("sha256").update(png).digest("hex");
      await api
        .post(`/v1/items/${itemId}/media`)
        .set("authorization", `Bearer ${token}`)
        .send({
          id: mediaId,
          operationId: randomUUID(),
          role: "original",
          mimeType: "image/png",
          byteSize: png.length,
          sha256: hash,
        })
        .expect(201);
      await api
        .put(`/v1/uploads/${mediaId}`)
        .set("authorization", `Bearer ${token}`)
        .set("content-type", "image/png")
        .send(png)
        .expect(200);
      const oversizedMediaId = randomUUID();
      await api
        .post(`/v1/items/${itemId}/media`)
        .set("authorization", `Bearer ${token}`)
        .send({
          id: oversizedMediaId,
          operationId: randomUUID(),
          role: "detail",
          mimeType: "image/png",
          byteSize: 1,
          sha256: createHash("sha256").update("12").digest("hex"),
        })
        .expect(201);
      await api
        .put(`/v1/uploads/${oversizedMediaId}`)
        .set("authorization", `Bearer ${token}`)
        .set("content-type", "image/png")
        .send("12")
        .expect(400)
        .expect(({ body }) => {
          if (body.code !== "UPLOAD_TOO_LARGE")
            throw new Error(`Unexpected upload error ${body.code}`);
        });
      await api
        .post(`/v1/media/${oversizedMediaId}/confirm`)
        .set("authorization", `Bearer ${token}`)
        .send({ operationId: randomUUID() })
        .expect(400);
      await api
        .post(`/v1/media/${mediaId}/confirm`)
        .set("authorization", `Bearer ${token}`)
        .send({ operationId: randomUUID() })
        .expect(201);
      const ownContent = await api
        .get(`/v1/media/${mediaId}/content`)
        .set("authorization", `Bearer ${token}`)
        .buffer(true)
        .parse(binaryParser)
        .expect("content-type", /image\/png/)
        .expect(200);
      expect(Buffer.compare(ownContent.body, png)).toBe(0);
      const next = await api
        .post("/v1/auth/register")
        .send({ email: "http2@example.test", password })
        .expect(201);
      await api
        .get(`/v1/media/${mediaId}/content`)
        .set("authorization", `Bearer ${next.body.token}`)
        .expect(404);
      const afterCapture = await api
        .get("/v1/items")
        .set("authorization", `Bearer ${token}`)
        .expect(200);
      const deleted = await api
        .patch(`/v1/items/${itemId}`)
        .set("authorization", `Bearer ${token}`)
        .send({
          operationId: randomUUID(),
          expectedVersion: afterCapture.body.items[0].version,
          deleted: true,
        })
        .expect(200);
      expect(deleted.body.deletedAt).toBeTruthy();
      await api
        .get("/v1/items")
        .set("authorization", `Bearer ${token}`)
        .expect(({ body }) => {
          if (body.items.length !== 0)
            throw new Error("Deleted item is listed");
        })
        .expect(200);
      await api
        .patch(`/v1/items/${itemId}`)
        .set("authorization", `Bearer ${token}`)
        .send({
          operationId: randomUUID(),
          expectedVersion: deleted.body.version,
          deleted: false,
        })
        .expect(200);
      await api
        .post(`/v1/items/${itemId}/process`)
        .set("authorization", `Bearer ${token}`)
        .send({ operationId: randomUUID() })
        .expect(201);
      const zip = await api
        .get("/v1/export")
        .set("authorization", `Bearer ${token}`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      await api
        .post("/v1/import")
        .set("authorization", `Bearer ${next.body.token}`)
        .set("content-type", "application/zip")
        .send(zip.body as Buffer)
        .expect(201);
    } finally {
      await app.close();
    }
  });
  it("rejects a forged same-owner archive before attaching media to another account item", async () => {
    const victim = await auth.register(
      "victim@example.test",
      "this is a valid password",
    );
    const attacker = await auth.register(
      "attacker@example.test",
      "this is a valid password",
    );
    const victimItem = await items.create(
      victim.user.id,
      randomUUID(),
      input(),
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+0d7lAAAAAElFTkSuQmCC",
      "base64",
    );
    const mediaId = randomUUID();
    const hash = createHash("sha256").update(png).digest("hex");
    const manifest = {
      version: 1,
      archiveOwnerId: attacker.user.id,
      items: [
        {
          id: victimItem.id,
          category: "energy",
          title: "forged",
          notes: "",
          captured_at: "2026-09-05T00:00:00.000Z",
          version: 1,
          input_revision: 0,
          recognition_status: "unassigned",
          presentation_status: "pending",
          deleted_at: null,
        },
      ],
      sessions: [],
      media: [
        {
          id: mediaId,
          item_id: victimItem.id,
          role: "original",
          mime_type: "image/png",
          sha256: hash,
        },
      ],
      artwork: [],
      checksums: { [`media/${mediaId}`]: hash },
    };
    const archiveBytes = Buffer.from(
      zipSync({
        "manifest.json": Buffer.from(JSON.stringify(manifest)),
        [`media/${mediaId}`]: png,
      }),
    );
    await expect(
      archive.restore(attacker.user.id, archiveBytes),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await db.query(
          "SELECT count(*)::int count FROM media_assets WHERE item_id=$1",
          [victimItem.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("rejects an oversized local upload before it can be confirmed", async () => {
    const user = await auth.register(
      "oversize@example.test",
      "this is a valid password",
    );
    const item = await items.create(user.user.id, randomUUID(), input());
    const mediaId = randomUUID();
    const bytes = Buffer.from("12");
    await media.create(user.user.id, item.id, {
      id: mediaId,
      operationId: randomUUID(),
      role: "original",
      mimeType: "image/png",
      byteSize: 1,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await expect(
      media.upload(user.user.id, mediaId, Readable.from(bytes)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      media.confirm(user.user.id, mediaId, randomUUID()),
    ).rejects.toMatchObject({ status: 400 });
  });
});
