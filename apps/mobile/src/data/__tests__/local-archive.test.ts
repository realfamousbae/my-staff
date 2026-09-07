import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  archiveIdMaps,
  decodeArchive,
  LOCAL_ARCHIVE_FORMAT,
  selectOwnerBackup,
  verifyArchiveChecksums,
} from "../local-archive";
const item = "00000000-0000-4000-8000-000000000001",
  media = "00000000-0000-4000-8000-000000000002";
const bytes = new Uint8Array([1, 2, 3]);
const hash = async (value: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const checksum = await hash(bytes);
const archive = () =>
  ({
    format: LOCAL_ARCHIVE_FORMAT,
    version: 1,
    ownerId: "a",
    items: [
      {
        id: item,
        category: "energy",
        title: null,
        notes: null,
        editionName: null,
        sessionId: null,
        capturedAt: "2026-09-05T00:00:00Z",
        createdAt: "2026-09-05T00:00:00Z",
        updatedAt: "2026-09-05T00:00:00Z",
        deletedAt: null,
        captureState: "saved",
      },
    ],
    sessions: [],
    media: [
      {
        id: media,
        itemId: item,
        role: "original",
        mimeType: "image/png",
        byteSize: 3,
        file: `media/${media}`,
        sha256: checksum,
      },
    ],
    checksums: { [`media/${media}`]: checksum },
  }) as any;
const zip = (value = archive()) =>
  zipSync({
    "manifest.json": strToU8(JSON.stringify(value)),
    [`media/${media}`]: bytes,
  });
describe("production local archive parser", () => {
  it("roundtrips actual zip bytes through production decoder and checksum validator", async () => {
    const files = decodeArchive(zip());
    await expect(
      verifyArchiveChecksums(archive(), files, hash),
    ).resolves.toBeUndefined();
  });
  it("rejects altered media bytes before import can mutate any record", async () => {
    const files = decodeArchive(zip());
    files[`media/${media}`] = new Uint8Array([3, 2, 1]);
    await expect(
      verifyArchiveChecksums(archive(), files, hash),
    ).rejects.toThrow("Повреждён");
  });
  it("scopes export and hides signed-out account data", () => {
    const records = [{ ownerId: "a" }, { ownerId: "b" }, { ownerId: null }];
    expect(selectOwnerBackup(records, "a")).toHaveLength(2);
    expect(selectOwnerBackup(records, null)).toEqual([{ ownerId: null }]);
  });
  it("maps a repeated cross-owner archive to stable IDs", async () => {
    const stable = async (o: string | null, id: string) => `${o}:${id}`;
    const one = await archiveIdMaps(archive(), "b", stable),
      two = await archiveIdMaps(archive(), "b", stable);
    expect(one.items.get(item)).toBe(two.items.get(item));
    expect(one.items.get(item)).not.toBe(item);
  });
  it("rejects oversized central-directory entry before decompression", () => {
    const encoded = zip();
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    );
    for (let i = 0; i < encoded.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 401 * 1024 * 1024, true);
        break;
      }
    expect(() => decodeArchive(encoded)).toThrow("слишком велик");
  });
  it("rejects traversing and unexpected paths", () =>
    expect(() =>
      decodeArchive(zipSync({ "../manifest.json": strToU8("{}") })),
    ).toThrow("Недопустимые"));
});
