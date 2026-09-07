import type { CaptureSession, LocalItem, LocalMedia } from "./types";
import { unzipSync } from "fflate";
export const LOCAL_ARCHIVE_FORMAT = "my-collection-local";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type LocalArchive = {
  format?: string;
  ownerId?: string | null;
  version: number;
  items: LocalItem[];
  sessions?: CaptureSession[];
  media: Array<LocalMedia & { file?: string }>;
  checksums?: Record<string, string>;
};
export function assertArchiveLimits(
  files: number,
  bytes: number,
  maxFiles: number,
  maxBytes: number,
) {
  if (files > maxFiles || bytes > maxBytes)
    throw new Error("Архив слишком велик после распаковки");
}
/** fflate calls filter against central-directory sizes before allocating output. */
export function decodeArchive(bytes: Uint8Array) {
  if (bytes.length > 200 * 1024 * 1024)
    throw new Error("Архив превышает 200 МБ");
  let count = 0,
    total = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (entry) => {
      count++;
      total += entry.originalSize;
      assertArchiveLimits(count, total, 2000, 400 * 1024 * 1024);
      if (
        names.has(entry.name) ||
        !(
          entry.name === "manifest.json" ||
          /^media\/[0-9a-f-]{36}$/i.test(entry.name)
        )
      )
        throw new Error("Недопустимые файлы в архиве");
      names.add(entry.name);
      return true;
    },
  });
  if (!files["manifest.json"]) throw new Error("В архиве нет manifest.json");
  return files;
}
export function validateLocalArchive(
  value: LocalArchive,
  files: Record<string, Uint8Array>,
) {
  if (
    value.format !== LOCAL_ARCHIVE_FORMAT ||
    value.version !== 1 ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.media) ||
    !value.checksums
  )
    throw new Error("Неподдерживаемая версия архива");
  if (
    value.items.some((x) => !UUID.test(x.id)) ||
    value.media.some(
      (x) =>
        !UUID.test(x.id) ||
        !UUID.test(x.itemId) ||
        !x.file ||
        !value.items.some((item) => item.id === x.itemId),
    )
  )
    throw new Error("Архив содержит некорректные ссылки");
  for (const x of value.media)
    if (!files[x.file!] || value.checksums[x.file!] !== x.sha256)
      throw new Error(`Повреждён оригинал ${x.id}`);
  const invalid = () => {
    throw new Error("Некорректные данные резервного архива");
  };
  const date = (x: unknown) =>
    typeof x === "string" && Number.isFinite(Date.parse(x));
  const nullableText = (x: unknown) =>
    x === null || (typeof x === "string" && x.length <= 20_000);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(value.items.map((x) => x.id)) ||
    !unique(value.media.map((x) => x.id)) ||
    !unique(value.sessions!.map((x) => x.id))
  )
    invalid();
  for (const s of value.sessions!)
    if (
      !UUID.test(s.id) ||
      !date(s.startedAt) ||
      (s.endedAt !== null && !date(s.endedAt)) ||
      !nullableText(s.title)
    )
      invalid();
  for (const item of value.items) {
    if (
      !["energy", "pringles"].includes(item.category) ||
      !nullableText(item.title) ||
      !nullableText(item.notes) ||
      !nullableText(item.editionName) ||
      !date(item.capturedAt) ||
      !date(item.createdAt) ||
      !date(item.updatedAt) ||
      (item.deletedAt !== null && !date(item.deletedAt)) ||
      item.captureState !== "saved" ||
      (item.sessionId !== null &&
        !value.sessions!.some((s) => s.id === item.sessionId))
    )
      invalid();
    if (!value.media.some((m) => m.itemId === item.id && m.role === "original"))
      invalid();
  }
  const allowed = new Set(["manifest.json"]);
  for (const m of value.media) {
    if (
      m.file !== `media/${m.id}` ||
      !["original", "detail", "artwork", "thumbnail"].includes(m.role) ||
      !["image/jpeg", "image/png", "image/webp"].includes(m.mimeType) ||
      !Number.isSafeInteger(m.byteSize) ||
      m.byteSize < 1 ||
      m.byteSize > 30 * 1024 * 1024 ||
      files[m.file!]!.length !== m.byteSize ||
      !/^[a-f0-9]{64}$/i.test(m.sha256)
    )
      invalid();
    allowed.add(m.file!);
  }
  if (Object.keys(files).some((name) => !allowed.has(name))) invalid();
}
export async function verifyArchiveChecksums(
  value: LocalArchive,
  files: Record<string, Uint8Array>,
  hash: (bytes: Uint8Array) => Promise<string>,
) {
  validateLocalArchive(value, files);
  for (const media of value.media)
    if ((await hash(files[media.file!]!)) !== media.sha256)
      throw new Error(`Повреждён оригинал ${media.id}`);
}
export function selectOwnerBackup<T extends { ownerId: string | null }>(
  items: T[],
  owner: string | null,
) {
  return items.filter(
    (item) => item.ownerId === owner || item.ownerId === null,
  );
}
export async function archiveIdMaps(
  value: LocalArchive,
  owner: string | null,
  stable: (owner: string | null, id: string) => Promise<string>,
) {
  const crossOwner = value.ownerId !== owner,
    items = new Map<string, string>(),
    media = new Map<string, string>(),
    sessions = new Map<string, string>();
  for (const x of value.items)
    items.set(x.id, crossOwner ? await stable(owner, x.id) : x.id);
  for (const x of value.media)
    media.set(x.id, crossOwner ? await stable(owner, x.id) : x.id);
  for (const x of value.sessions ?? [])
    sessions.set(x.id, crossOwner ? await stable(owner, x.id) : x.id);
  return { crossOwner, items, media, sessions };
}
