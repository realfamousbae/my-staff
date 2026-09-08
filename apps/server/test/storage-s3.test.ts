import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { StorageService } from "../src/storage/storage.service";

// Exercise the real SDK's signing, HTTP transport, XML parsing and streams
// against loopback only. This fixture is not a substitute for an S3 deployment test.
describe("S3 storage SDK compatibility", () => {
  const objects = new Map<string, Buffer>();
  const signedRequests: boolean[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const key = decodeURIComponent(url.pathname);
    signedRequests.push(
      request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") ??
        url.searchParams.has("X-Amz-Signature"),
    );
    if (request.method === "PUT") {
      if (request.headers["x-amz-copy-source"]) {
        const source =
          "/" + String(request.headers["x-amz-copy-source"]).replace(/^\//, "");
        const bytes = objects.get(decodeURIComponent(source.split("?")[0]));
        if (!bytes) {
          response.writeHead(404).end();
          return;
        }
        objects.set(key, bytes);
        response.setHeader("Content-Type", "application/xml");
        response.end(
          "<CopyObjectResult><ETag>&quot;fixture-etag&quot;</ETag><LastModified>2026-09-08T00:00:00.000Z</LastModified></CopyObjectResult>",
        );
      } else {
        if (request.headers["if-none-match"] === "*" && objects.has(key)) {
          response.writeHead(412, { "Content-Type": "application/xml" });
          response.end(
            "<Error><Code>PreconditionFailed</Code><Message>Object exists</Message></Error>",
          );
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        objects.set(key, Buffer.concat(chunks));
        response.setHeader("ETag", '"fixture-etag"');
        response.end();
      }
      return;
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      response.writeHead(204).end();
      return;
    }
    const bytes = objects.get(key);
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Length", bytes.length);
    response.setHeader("ETag", '"fixture-etag"');
    response.end(request.method === "HEAD" ? undefined : bytes);
  });
  let storage: StorageService;
  const bytes = Buffer.from("89504e470d0a1a0a000102030405", "hex");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv("AWS_PROFILE", undefined);
    for (const [key, value] of Object.entries({
      STORAGE_DRIVER: "s3",
      S3_REGION: "us-east-1",
      S3_BUCKET: "test-bucket",
      S3_ENDPOINT: endpoint,
      S3_FORCE_PATH_STYLE: "true",
      AWS_ACCESS_KEY_ID: "fixture-access-key",
      AWS_SECRET_ACCESS_KEY: "fixture-secret-key",
      AWS_SESSION_TOKEN: "fixture-session",
      AWS_EC2_METADATA_DISABLED: "true",
    }))
      vi.stubEnv(key, value);
    storage = new StorageService();
  });
  beforeEach(() => {
    objects.clear();
    signedRequests.length = 0;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  it("signs an upload, verifies original bytes, copies to immutable storage and reads them back", async () => {
    const ticket = await storage.uploadUrl("photo", "image/png");
    // The photo is supplied later by the mobile client; signing the checksum
    // of the presigner's empty body would make S3 reject nonempty uploads.
    expect(
      new URL(ticket.uploadUrl).searchParams.has("x-amz-checksum-crc32"),
    ).toBe(false);
    const uploaded = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.uploadHeaders,
      body: bytes,
    });
    expect(uploaded.ok).toBe(true);
    expect(
      await storage.confirm("photo", bytes.length, sha256, "image/png"),
    ).toEqual({ size: bytes.length, sha256 });
    expect(objects.has("/test-bucket/pending/photo")).toBe(false);
    const result: Buffer[] = [];
    for await (const chunk of await storage.read("photo"))
      result.push(Buffer.from(chunk));
    expect(Buffer.concat(result)).toEqual(bytes);
    expect(signedRequests.every(Boolean)).toBe(true);
  });
  it("rejects a corrupt upload and preserves immutable objects on a second write", async () => {
    objects.set("/test-bucket/pending/bad", bytes);
    await expect(
      storage.confirm("bad", bytes.length, "0".repeat(64), "image/png"),
    ).rejects.toThrow("checksum");
    expect(objects.has("/test-bucket/originals/bad")).toBe(false);
    expect(await storage.writeImmutable("art", bytes, "image/png")).toEqual({
      size: bytes.length,
      sha256,
    });
    await expect(
      storage.writeImmutable("art", Buffer.from("different"), "image/png"),
    ).rejects.toMatchObject({
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });
    expect(objects.get("/test-bucket/originals/art")).toEqual(bytes);
  });
});
