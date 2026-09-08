import { Injectable } from "@nestjs/common";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  rename,
  stat,
  writeFile,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { pipeline, finished } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
export type Stored = { size: number; sha256: string };
@Injectable()
export class StorageService {
  private readonly mode = process.env.STORAGE_DRIVER ?? "local";
  private readonly root =
    process.env.LOCAL_STORAGE_DIR ?? join(process.cwd(), ".storage");
  private readonly bucket = process.env.S3_BUCKET;
  private readonly s3 =
    this.mode === "s3"
      ? new S3Client({
          region: process.env.S3_REGION,
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
          // Presigned uploads have no body here: the mobile client sends it
          // later. Do not sign CRC32 of an empty body; confirm() verifies the
          // actual original's size, SHA-256 and image signature before copying.
          requestChecksumCalculation: "WHEN_REQUIRED",
        })
      : undefined;
  private pending(id: string) {
    return `pending/${id}`;
  }
  private final(id: string) {
    return `originals/${id}`;
  }
  private file(key: string) {
    return join(this.root, key);
  }
  async uploadUrl(id: string, mime: string) {
    if (this.mode === "local")
      return {
        uploadUrl: `/v1/uploads/${id}`,
        uploadHeaders: { "content-type": mime },
      };
    if (!this.bucket || !this.s3)
      throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    return {
      uploadUrl: await getSignedUrl(
        this.s3,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.pending(id),
          ContentType: mime,
        }),
        { expiresIn: 900 },
      ),
      uploadHeaders: { "content-type": mime },
    };
  }
  async writePending(
    id: string,
    source: NodeJS.ReadableStream,
    maximumBytes?: number,
  ) {
    if (this.mode !== "local")
      throw new Error("Direct uploads are not available for S3 storage");
    const path = this.file(this.pending(id));
    await mkdir(dirname(path), { recursive: true });
    // Never expose a partially written pending object. In particular, an HTTP
    // request can fail halfway through an upload or exceed its declared size.
    const temporary = `${path}.${randomUUID()}.upload`;
    let received = 0;
    let tooLarge = false;
    const target = createWriteStream(temporary, { flags: "wx" });
    try {
      // Do not destroy an incoming HTTP request on a size violation. Draining
      // it lets Nest return a normal 400 response instead of resetting the
      // socket, while the temporary file is removed below.
      for await (const raw of source) {
        const chunk = Buffer.from(raw);
        received += chunk.length;
        if (maximumBytes !== undefined && received > maximumBytes) {
          tooLarge = true;
          continue;
        }
        if (!target.write(chunk)) await once(target, "drain");
      }
      target.end();
      await finished(target);
      if (tooLarge) throw new Error("Upload exceeds declared byte size");
      await rename(temporary, path);
    } catch (error) {
      target.destroy();
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  async confirm(
    id: string,
    expectedSize: number,
    expectedHash: string,
    mimeType?: string,
  ): Promise<Stored> {
    if (this.mode === "local") {
      const from = this.file(this.pending(id)),
        to = this.file(this.final(id));
      let actual: Stored;
      try {
        await stat(to);
        actual = await hashFile(to);
        if (actual.size !== expectedSize || actual.sha256 !== expectedHash)
          throw new Error("Immutable object differs from declared media");
        if (mimeType && !isImage(await readFile(to), mimeType))
          throw new Error(
            "Object signature does not match declared image MIME type",
          );
        return actual;
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      actual = await hashFile(from);
      if (actual.size !== expectedSize || actual.sha256 !== expectedHash)
        throw new Error(
          "Object checksum or size does not match declared media",
        );
      if (mimeType && !isImage(await readFile(from), mimeType))
        throw new Error(
          "Object signature does not match declared image MIME type",
        );
      await mkdir(dirname(to), { recursive: true });
      try {
        await stat(to);
        return actual;
      } catch {}
      await rename(from, to);
      return actual;
    }
    if (!this.bucket || !this.s3) throw new Error("S3_BUCKET is required");
    const key = this.pending(id),
      head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    if (Number(head.ContentLength) !== expectedSize)
      throw new Error("Object size does not match declared media");
    const object = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: head.VersionId,
      }),
    );
    const actual = await hashStream(object.Body as AsyncIterable<Uint8Array>);
    if (actual.size !== expectedSize || actual.sha256 !== expectedHash)
      throw new Error("Object checksum or size does not match declared media");
    if (mimeType && !isImage(actual.prefix, mimeType))
      throw new Error(
        "Object signature does not match declared image MIME type",
      );
    const finalKey = this.final(id),
      existing = await this.s3
        .send(new HeadObjectCommand({ Bucket: this.bucket, Key: finalKey }))
        .catch(() => undefined);
    if (existing) {
      const final = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: finalKey,
          VersionId: existing.VersionId,
        }),
      );
      const verified = await hashStream(
        final.Body as AsyncIterable<Uint8Array>,
      );
      if (
        verified.size !== expectedSize ||
        verified.sha256 !== expectedHash ||
        (mimeType && !isImage(verified.prefix, mimeType))
      )
        throw new Error("Immutable object differs from declared media");
      return { size: verified.size, sha256: verified.sha256 };
    }
    let source = `${this.bucket}/${key}`;
    if (head.VersionId)
      source += `?versionId=${encodeURIComponent(head.VersionId)}`;
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: source,
        CopySourceIfMatch: head.ETag,
        Key: finalKey,
      }),
    );
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: head.VersionId,
      }),
    );
    return { size: actual.size, sha256: actual.sha256 };
  }
  async read(id: string) {
    if (this.mode === "local")
      return createReadStream(this.file(this.final(id)));
    if (!this.bucket || !this.s3) throw new Error("S3_BUCKET is required");
    const r = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.final(id) }),
    );
    return r.Body as NodeJS.ReadableStream;
  }
  async writeImmutable(
    id: string,
    bytes: Uint8Array,
    mimeType?: string,
  ): Promise<Stored> {
    const stored = {
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    if (this.mode === "local") {
      const path = this.file(this.final(id));
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, bytes, { flag: "wx" });
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        const existing = await hashFile(path);
        if (existing.sha256 !== stored.sha256)
          throw new Error(
            "Immutable object already exists with different bytes",
          );
      }
      return stored;
    }
    if (!this.bucket || !this.s3) throw new Error("S3_BUCKET is required");
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.final(id),
        Body: bytes,
        ContentType: mimeType,
        IfNoneMatch: "*",
      }),
    );
    return stored;
  }
}
async function hashFile(file: string): Promise<Stored> {
  const hash = createHash("sha256");
  let size = 0;
  const source = createReadStream(file);
  for await (const chunk of source) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: hash.digest("hex") };
}
function isImage(data: Buffer, mime: string) {
  return mime === "image/png"
    ? data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
    : mime === "image/jpeg"
      ? data.length > 3 &&
        data[0] === 0xff &&
        data[1] === 0xd8 &&
        data[2] === 0xff
      : mime === "image/webp"
        ? data.subarray(0, 4).toString() === "RIFF" &&
          data.subarray(8, 12).toString() === "WEBP"
        : false;
}
async function hashStream(stream: AsyncIterable<Uint8Array>) {
  const hash = createHash("sha256");
  let size = 0;
  const first: Buffer[] = [];
  let captured = 0;
  for await (const chunk of stream) {
    const data = Buffer.from(chunk);
    hash.update(data);
    size += data.length;
    if (captured < 12) {
      const part = data.subarray(0, 12 - captured);
      first.push(part);
      captured += part.length;
    }
  }
  return { size, sha256: hash.digest("hex"), prefix: Buffer.concat(first) };
}
