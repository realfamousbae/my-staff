import type { Category, Item } from "@my-staff/contracts";
import type { Edition } from "@my-staff/contracts";
import type { CollectionFilter, CollectionItem } from "../models";
import { CaptureCoordinator } from "./capture";
import { ApiClient, ExpoFiles, ExpoRuntime, ExpoSecureSession } from "./native";
import { ExpoSqliteStore } from "./sqlite-store";
import { SyncCoordinator } from "./sync";
import {
  belongsToCurrentOwner,
  mayApplyRemoteSnapshot,
} from "./snapshot-policy";
import {
  LOCAL_ARCHIVE_FORMAT,
  decodeArchive,
  archiveIdMaps,
  selectOwnerBackup,
  verifyArchiveChecksums,
  type LocalArchive,
} from "./local-archive";
import type {
  AuthSession,
  CaptureSession,
  LocalItem,
  LocalMedia,
} from "./types";

export type DataSnapshot = {
  ready: boolean;
  items: CollectionItem[];
  activeSession: {
    id: string;
    title?: string | null;
    startedAt: string;
    itemCount: number;
  } | null;
  auth: AuthSession | null;
};
type Listener = () => void;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function stableArchiveId(owner: string | null, id: string) {
  const digest = await sha256(
    new TextEncoder().encode(`${owner ?? "anonymous"}:${id}`),
  );
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
const LOCAL_ARCHIVE_MAX_BYTES = 200 * 1024 * 1024;
const LOCAL_ARCHIVE_MAX_EXPANDED = 400 * 1024 * 1024;
const LOCAL_ARCHIVE_MAX_FILES = 2_000;
async function sha256(bytes: Uint8Array) {
  const crypto = await import("expo-crypto");
  const digest = new Uint8Array(
    // Expo's Android bridge accepts a typed byte array; a raw ArrayBuffer
    // passes TypeScript validation but fails on Hermes at runtime.
    await crypto.digest(
      crypto.CryptoDigestAlgorithm.SHA256,
      new Uint8Array(bytes),
    ),
  );
  return Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

/** Native singleton used by screens. Records are emitted immediately from SQLite, never from network optimism. */
export class DataLayer {
  private store: ExpoSqliteStore | null = null;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private files = new ExpoFiles();
  private runtime = new ExpoRuntime();
  private secure = new ExpoSecureSession();
  private session: AuthSession | null = null;
  private apiUrl = "http://10.0.2.2:3000";
  private listeners = new Set<Listener>();
  private activeSessionId: string | null = null;
  private capture!: CaptureCoordinator;
  private sync!: SyncCoordinator;
  async initialize() {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    this.initialization = this.open();
    try {
      await this.initialization;
      this.initialized = true;
    } finally {
      this.initialization = null;
    }
  }
  private async open() {
    this.store ??= await ExpoSqliteStore.open();
    this.apiUrl = (await this.store.getSetting("apiUrl")) ?? this.apiUrl;
    this.session = await this.secure.get();
    if (this.session && this.session.origin !== this.apiUrl) {
      await this.secure.clear();
      this.session = null;
    }
    const api = new ApiClient(
      () => this.apiUrl,
      () => this.session?.token ?? null,
    );
    this.capture = new CaptureCoordinator(this.store, this.files, this.runtime);
    this.sync = new SyncCoordinator(this.store, api, this.files, this.runtime);
    await this.capture.recover();
    await this.emit();
    if (this.session) {
      await this.store.bindUnownedDrafts(this.session.user.id);
      await this.enqueueBoundDrafts(this.session.user.id);
      void this.refresh().catch(() => undefined);
    }
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async snapshot(): Promise<DataSnapshot> {
    await this.initialize();
    const store = this.requireStore();
    const owner = this.session?.user.id ?? null;
    const sessions = (await store.listSessions()).filter((s) =>
      belongsToCurrentOwner(s.ownerId, owner),
    );
    const active =
      sessions.find((s) => s.id === this.activeSessionId) ??
      sessions.find((s) => !s.endedAt) ??
      null;
    const all = (await store.listItems()).filter((x) =>
      belongsToCurrentOwner(x.ownerId, owner),
    );
    return {
      ready: true,
      items: await Promise.all(all.map((x) => this.toUi(x))),
      activeSession: active
        ? {
            id: active.id,
            title: active.title,
            startedAt: active.startedAt,
            itemCount: all.filter((x) => x.sessionId === active.id).length,
          }
        : null,
      auth: this.session,
    };
  }
  async setApiUrl(url: string) {
    await this.initialize();
    const normal = url.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(normal))
      throw new Error("Адрес сервера должен начинаться с http:// или https://");
    if (this.session && normal !== this.apiUrl)
      throw new Error("Сначала выйдите из аккаунта перед сменой сервера");
    this.apiUrl = normal;
    await this.requireStore().setSetting("apiUrl", normal);
  }
  async register(email: string, password: string): Promise<void> {
    await this.authenticate("/v1/auth/register", email, password);
  }
  async login(email: string, password: string): Promise<void> {
    await this.authenticate("/v1/auth/login", email, password);
  }
  async logout() {
    await this.initialize();
    await this.secure.clear();
    this.session = null;
    this.activeSessionId = null;
    await this.emit();
  }
  async restoreSession() {
    await this.initialize();
    return this.session;
  }
  async createSession(title: string | null = null) {
    await this.initialize();
    const result = await this.capture.startSession(
      title,
      this.session?.user.id ?? null,
    );
    this.activeSessionId = result.id;
    await this.emit();
    return {
      id: result.id,
      title: result.title,
      startedAt: result.startedAt,
      itemCount: 0,
    };
  }
  async capturePhoto(photoUri: string, category: Category, sessionId?: string) {
    await this.initialize();
    const item = await this.capture.saveNew(photoUri, {
      category,
      sessionId: sessionId ?? this.activeSessionId,
      ownerId: this.session?.user.id ?? null,
    });
    await this.emit();
    if (this.session) void this.syncAndEmit();
    return this.toUi(item);
  }
  async importPhoto(photoUri: string, category: Category, sessionId?: string) {
    return this.capturePhoto(photoUri, category, sessionId);
  }
  async attachPhoto(itemId: string, photoUri: string) {
    await this.initialize();
    await this.capture.attachPhoto(
      itemId,
      photoUri,
      this.session?.user.id ?? null,
    );
    await this.emit();
    if (this.session) void this.syncAndEmit();
  }
  async updateItem(
    id: string,
    patch: Partial<
      Pick<LocalItem, "title" | "editionName" | "notes" | "category">
    >,
  ) {
    await this.initialize();
    const store = this.requireStore();
    const item = await store.getItem(id);
    if (!item) throw new Error("Предмет не найден");
    const changed = {
      ...item,
      ...patch,
      updatedAt: this.runtime.now(),
      syncState: item.ownerId ? ("pending" as const) : item.syncState,
    };
    await store.putItem(changed);
    if (changed.ownerId) {
      const body =
        changed.version === null
          ? {
              category: changed.category,
              title: changed.title ?? "",
              notes: changed.notes ?? "",
              sessionId: changed.sessionId,
              capturedAt: changed.capturedAt,
            }
          : {
              expectedVersion: changed.version,
              ...(patch.title !== undefined
                ? { title: patch.title ?? "" }
                : {}),
              ...(patch.notes !== undefined
                ? { notes: patch.notes ?? "" }
                : {}),
              ...(patch.category !== undefined
                ? { category: patch.category }
                : {}),
            };
      await store.putOperation({
        id: this.runtime.id(),
        ownerId: changed.ownerId,
        kind: "upsert_item",
        itemId: id,
        mediaId: null,
        payload: {
          create: changed.version === null,
          body,
          base: {
            title: item.title ?? "",
            notes: item.notes ?? "",
            category: item.category,
          },
        },
        attempts: 0,
        nextAttemptAt: this.runtime.now(),
        lastError: null,
        createdAt: this.runtime.now(),
        updatedAt: this.runtime.now(),
      });
    }
    await this.emit();
    if (this.session) void this.syncAndEmit();
  }
  async retry(itemId: string) {
    await this.initialize();
    const item = await this.requireStore().getItem(itemId);
    if (!item?.ownerId) return;
    const body =
      item.version === null
        ? {
            category: item.category,
            title: item.title ?? "",
            notes: item.notes ?? "",
            sessionId: item.sessionId,
            capturedAt: item.capturedAt,
          }
        : {
            expectedVersion: item.version,
            title: item.title ?? "",
            notes: item.notes ?? "",
            category: item.category,
            editionId: item.editionId,
          };
    const store = this.requireStore();
    await store.putOperation({
      id: this.runtime.id(),
      ownerId: item.ownerId,
      kind: "upsert_item",
      itemId,
      mediaId: null,
      payload: { create: item.version === null, body },
      attempts: 0,
      nextAttemptAt: this.runtime.now(),
      lastError: null,
      createdAt: this.runtime.now(),
      updatedAt: this.runtime.now(),
    });
    const media = await store.listMediaForItem(itemId);
    for (const entry of media)
      if (entry.state !== "confirmed")
        await store.putOperation({
          id: this.runtime.id(),
          ownerId: item.ownerId,
          kind: "upload_media",
          itemId,
          mediaId: entry.id,
          payload: {},
          attempts: 0,
          nextAttemptAt: this.runtime.now(),
          lastError: null,
          createdAt: this.runtime.now(),
          updatedAt: this.runtime.now(),
        });
    if (media.length > 0 && media.every((entry) => entry.state === "confirmed"))
      await store.putOperation({
        id: this.runtime.id(),
        ownerId: item.ownerId,
        kind: "process_item",
        itemId,
        mediaId: null,
        payload: {},
        attempts: 0,
        nextAttemptAt: this.runtime.now(),
        lastError: null,
        createdAt: this.runtime.now(),
        updatedAt: this.runtime.now(),
      });
    await this.syncAndEmit();
  }
  async catalogEditions(): Promise<Edition[]> {
    await this.initialize();
    if (!this.session) return [];
    const api = new ApiClient(
      () => this.apiUrl,
      () => this.session?.token ?? null,
    );
    return (
      await api.request<{ editions: Edition[] }>("GET", "/v1/catalog/editions")
    ).editions;
  }
  async searchCatalog(query = "", category?: Category): Promise<Edition[]> {
    await this.initialize();
    if (!this.session) return [];
    const api = new ApiClient(
      () => this.apiUrl,
      () => this.session?.token ?? null,
    );
    const parameters = new URLSearchParams();
    if (query.trim()) parameters.set("q", query.trim());
    if (category) parameters.set("category", category);
    return (
      await api.request<{ editions: Edition[] }>(
        "GET",
        `/v1/catalog/editions${parameters.size ? `?${parameters}` : ""}`,
      )
    ).editions;
  }
  async chooseEdition(itemId: string, editionId: string | null) {
    await this.initialize();
    const store = this.requireStore();
    const item = await store.getItem(itemId);
    if (!item?.ownerId || item.version === null)
      throw new Error("Сначала синхронизируйте предмет");
    const edition = editionId
      ? (await this.catalogEditions()).find((x) => x.id === editionId)
      : null;
    const changed = {
      ...item,
      editionId,
      editionName: edition?.name ?? null,
      syncState: "pending" as const,
      updatedAt: this.runtime.now(),
    };
    await store.putItem(changed);
    await store.putOperation({
      id: this.runtime.id(),
      ownerId: item.ownerId,
      kind: "upsert_item",
      itemId,
      mediaId: null,
      payload: {
        create: false,
        body: { expectedVersion: item.version, editionId },
        base: { editionId: item.editionId },
      },
      attempts: 0,
      nextAttemptAt: this.runtime.now(),
      lastError: null,
      createdAt: this.runtime.now(),
      updatedAt: this.runtime.now(),
    });
    await this.emit();
    if (this.session) void this.syncAndEmit();
  }
  async setDeleted(itemId: string, deleted: boolean) {
    await this.initialize();
    const store = this.requireStore();
    const item = await store.getItem(itemId);
    if (!item) throw new Error("Предмет не найден");
    const changed = {
      ...item,
      deletedAt: deleted ? this.runtime.now() : null,
      syncState: item.ownerId ? ("pending" as const) : item.syncState,
      updatedAt: this.runtime.now(),
    };
    await store.putItem(changed);
    if (changed.ownerId && changed.version !== null)
      await store.putOperation({
        id: this.runtime.id(),
        ownerId: changed.ownerId,
        kind: "upsert_item",
        itemId,
        mediaId: null,
        payload: {
          create: false,
          body: { expectedVersion: changed.version, deleted },
          base: { deleted: !!item.deletedAt },
        },
        attempts: 0,
        nextAttemptAt: this.runtime.now(),
        lastError: null,
        createdAt: this.runtime.now(),
        updatedAt: this.runtime.now(),
      });
    await this.emit();
    if (this.session) void this.syncAndEmit();
  }
  async linkEdition(itemId: string, editionId: string | null) {
    return this.chooseEdition(itemId, editionId);
  }
  async deleteItem(itemId: string) {
    return this.setDeleted(itemId, true);
  }
  async restoreItem(itemId: string) {
    return this.setDeleted(itemId, false);
  }
  async proposeEdition(input: Record<string, unknown>): Promise<void> {
    await this.initialize();
    if (!this.session) throw new Error("Нужно войти в аккаунт");
    const api = new ApiClient(
      () => this.apiUrl,
      () => this.session?.token ?? null,
    );
    await api.request("POST", "/v1/catalog/editions", {
      ...input,
      operationId: this.runtime.id(),
    });
  }
  async refresh() {
    await this.initialize();
    if (!this.session) {
      await this.emit();
      return;
    }
    await this.sync.run(this.session.user.id);
    const api = new ApiClient(
      () => this.apiUrl,
      () => this.session?.token ?? null,
    );
    const response = await api.request<{ items: Item[] }>(
      "GET",
      "/v1/items?includeDeleted=true",
    );
    await this.mergeSnapshot(response.items);
    await this.emit();
  }
  /** Downloads originals only on explicit restore, using bearer-authenticated media content URLs. */
  async restoreOriginals(limit = 645) {
    await this.initialize();
    if (!this.session) throw new Error("Нужно войти в аккаунт");
    let count = 0;
    const api = new ApiClient(
      () => this.apiUrl,
      () => this.session?.token ?? null,
    );
    for (const item of await this.requireStore().listItems()) {
      if (item.ownerId !== this.session.user.id) continue;
      for (const media of await this.requireStore().listMediaForItem(item.id)) {
        if (count >= limit) return count;
        if (media.localPath || !media.remoteId || media.state !== "confirmed")
          continue;
        const path = await this.files.downloadAuthenticated(
          api.mediaUrl(media.remoteId),
          this.session.token,
          `${media.id}.restored`,
        );
        await this.requireStore().putMedia({
          ...media,
          localPath: path,
          updatedAt: this.runtime.now(),
        });
        count++;
      }
    }
    await this.emit();
    return count;
  }
  async filtered(filter: CollectionFilter) {
    const values = (await this.snapshot()).items;
    const term = filter.query?.trim().toLocaleLowerCase() ?? "";
    return values.filter(
      (x) =>
        (filter.category == null ||
          filter.category === "all" ||
          x.category === filter.category) &&
        (!term ||
          `${x.title ?? ""} ${x.editionName ?? ""} ${x.notes ?? ""}`
            .toLocaleLowerCase()
            .includes(term)),
    );
  }
  async deletedItems(): Promise<CollectionItem[]> {
    await this.initialize();
    const owner = this.session?.user.id ?? null;
    return Promise.all(
      (await this.requireStore().listItems(true))
        .filter(
          (item) =>
            !!item.deletedAt &&
            (item.ownerId === owner || item.ownerId === null),
        )
        .map((item) => this.toUi(item)),
    );
  }
  /** Complete device backup. It never substitutes a server-only archive for local pending originals. */
  async exportCollection(): Promise<string | null> {
    await this.initialize();
    const fs = await import("expo-file-system/legacy");
    const zip = await import("fflate");
    const store = this.requireStore();
    const owner = this.session?.user.id ?? null;
    const items = selectOwnerBackup(await store.listItems(true), owner);
    const sessions = selectOwnerBackup(await store.listSessions(), owner);
    const media = (
      await Promise.all(items.map((item) => store.listMediaForItem(item.id)))
    ).flat();
    if (
      media.reduce((total, entry) => total + entry.byteSize, 0) >
      LOCAL_ARCHIVE_MAX_BYTES
    )
      throw new Error("Резервная копия превышает 200 МБ");
    const api = this.session
      ? new ApiClient(
          () => this.apiUrl,
          () => this.session?.token ?? null,
        )
      : null;
    for (const entry of media)
      if (!entry.localPath) {
        if (!api || !entry.remoteId || entry.state !== "confirmed")
          throw new Error(
            `Не найден оригинал ${entry.id}; подключите сеть или восстановите его перед экспортом`,
          );
        const path = await this.files.downloadAuthenticated(
          api.mediaUrl(entry.remoteId),
          this.session!.token,
          `${entry.id}.backup`,
        );
        await store.putMedia({
          ...entry,
          localPath: path,
          updatedAt: this.runtime.now(),
        });
        entry.localPath = path;
      }
    const files: Record<string, Uint8Array> = {};
    const checksums: Record<string, string> = {};
    for (const entry of media) {
      const base64 = await fs.readAsStringAsync(entry.localPath!, {
        encoding: fs.EncodingType.Base64,
      });
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const hash = await sha256(bytes);
      if (hash !== entry.sha256)
        throw new Error(`Контрольная сумма оригинала ${entry.id} не совпадает`);
      const path = `media/${entry.id}`;
      files[path] = bytes;
      checksums[path] = hash;
    }
    const safeMedia = media.map(
      ({
        localPath,
        remoteId,
        uploadUrl,
        uploadHeaders,
        lastError,
        ...entry
      }) => ({
        ...entry,
        ownerId: null,
        remoteId: null,
        uploadUrl: null,
        uploadHeaders: null,
        lastError: null,
        state: "local",
        file: `media/${entry.id}`,
      }),
    );
    files["manifest.json"] = zip.strToU8(
      JSON.stringify({
        format: LOCAL_ARCHIVE_FORMAT,
        version: 1,
        ownerId: owner,
        exportedAt: this.runtime.now(),
        items,
        sessions,
        media: safeMedia,
        checksums,
      }),
    );
    const archive = zip.zipSync(files, { level: 6 });
    if (archive.length > LOCAL_ARCHIVE_MAX_BYTES)
      throw new Error("Архив превышает 200 МБ");
    let binary = "";
    for (let i = 0; i < archive.length; i += 0x8000)
      binary += String.fromCharCode(...archive.subarray(i, i + 0x8000));
    const uri = `${fs.documentDirectory}collection-backup.zip`;
    await fs.writeAsStringAsync(uri, btoa(binary), {
      encoding: fs.EncodingType.Base64,
    });
    return uri;
  }
  async importCollection(): Promise<void> {
    await this.initialize();
    const picker = await import("expo-document-picker");
    const selected = await picker.getDocumentAsync({
      type: "application/zip",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (selected.canceled || !selected.assets[0]) return;
    const archiveBytes = await this.files.readBytes(
      selected.assets[0].uri,
      LOCAL_ARCHIVE_MAX_BYTES,
    );
    const zip = await import("fflate");
    const files = decodeArchive(archiveBytes);
    const manifest = files["manifest.json"];
    if (!manifest) throw new Error("В архиве нет manifest.json");
    const data = JSON.parse(zip.strFromU8(manifest)) as LocalArchive;
    if (data.format !== "my-collection-local") {
      if (!this.session) throw new Error("Для серверного архива нужен аккаунт");
      const api = new ApiClient(
        () => this.apiUrl,
        () => this.session?.token ?? null,
      );
      await api.uploadBinary(
        "/v1/import",
        await this.files.read(selected.assets[0].uri),
      );
      await this.refresh();
      return;
    }
    await verifyArchiveChecksums(data, files, sha256);
    const store = this.requireStore();
    const targetOwner = this.session?.user.id ?? null,
      {
        crossOwner,
        items: itemIds,
        media: mediaIds,
        sessions: sessionIds,
      } = await archiveIdMaps(data, targetOwner, stableArchiveId);
    for (const session of data.sessions!) {
      const id = sessionIds.get(session.id)!;
      if (!(await store.listSessions()).some((value) => value.id === id))
        await store.putSession({ ...session, id, ownerId: targetOwner });
    }
    for (const item of data.items) {
      const id = itemIds.get(item.id)!;
      const existing = await store.getItem(id);
      if (existing && existing.ownerId !== targetOwner)
        throw new Error("Предмет принадлежит другому локальному аккаунту");
      if (!existing)
        await store.putItem({
          ...item,
          id,
          sessionId: item.sessionId
            ? (sessionIds.get(item.sessionId) ?? null)
            : null,
          ownerId: targetOwner,
          version: null,
          editionId: crossOwner ? null : item.editionId,
          syncState: targetOwner ? "pending" : "local_only",
        });
      for (const media of data.media.filter(
        (value) => value.itemId === item.id,
      )) {
        const previous = await store.getMedia(mediaIds.get(media.id)!);
        if (
          previous?.localPath &&
          (await this.files.info(previous.localPath)).exists
        )
          continue;
        const bytes = media.file ? files[media.file] : undefined;
        if (
          media.file &&
          (!bytes ||
            (data.checksums && data.checksums[media.file] !== media.sha256) ||
            (await sha256(bytes)) !== media.sha256)
        )
          throw new Error(`Повреждён оригинал ${media.id}`);
        const path = bytes
          ? await this.files.writeImported(
              `${mediaIds.get(media.id)!}.imported`,
              bytes,
            )
          : null;
        await store.putMedia({
          ...media,
          id: mediaIds.get(media.id)!,
          itemId: id,
          ownerId: targetOwner,
          localPath: path,
          remoteId: null,
          uploadUrl: null,
          uploadHeaders: null,
          lastError: null,
          state: path
            ? targetOwner &&
              (media.role === "original" || media.role === "detail")
              ? "pending"
              : "local"
            : "needs_attention",
        });
      }
    }
    if (targetOwner) {
      await this.enqueueBoundDrafts(targetOwner);
      void this.syncAndEmit();
    }
    await this.emit();
  }
  async clearTemporaryCache(): Promise<void> {
    /* Originals are deliberately never removed here. */
  }
  private async authenticate(path: string, email: string, password: string) {
    await this.initialize();
    const api = new ApiClient(
      () => this.apiUrl,
      () => null,
    );
    const value = {
      ...(await api.request<AuthSession>("POST", path, { email, password })),
      origin: this.apiUrl,
    };
    this.session = value;
    await this.secure.set(value);
    await this.requireStore().bindUnownedDrafts(value.user.id);
    await this.enqueueBoundDrafts(value.user.id);
    await this.refresh();
    return value;
  }
  private async syncAndEmit() {
    if (this.session) await this.sync.run(this.session.user.id);
    await this.emit();
  }
  private async mergeSnapshot(remote: Item[]) {
    const store = this.requireStore();
    for (const r of remote) {
      const local = await store.getItem(r.id);
      if (!mayApplyRemoteSnapshot(local)) continue;
      const mapped: LocalItem = {
        id: r.id,
        ownerId: r.ownerId,
        category: r.category,
        title: r.title,
        editionName: r.edition?.name ?? local?.editionName ?? null,
        editionId: r.editionId,
        notes: r.notes,
        sessionId: r.sessionId,
        capturedAt: r.capturedAt,
        version: r.version,
        recognitionStatus: r.recognitionStatus,
        artworkStatus: r.artworkStatus,
        captureState: "saved",
        syncState: "synced",
        deletedAt: r.deletedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
      await store.putItem(mapped);
      for (const asset of r.media) {
        const old = await store.getMedia(asset.id);
        let artworkPath: string | null = null;
        if (
          !old?.localPath &&
          asset.role === "artwork" &&
          asset.status === "confirmed" &&
          this.session?.user.id === r.ownerId
        ) {
          const api = new ApiClient(
            () => this.apiUrl,
            () => this.session?.token ?? null,
          );
          try {
            artworkPath = await this.files.downloadAuthenticated(
              api.mediaUrl(asset.id),
              this.session.token,
              `${asset.id}.artwork`,
            );
          } catch {
            /* Retry on the next foreground refresh. */
          }
        }
        if (old?.localPath)
          await store.putMedia({
            ...old,
            remoteId: asset.id,
            state: asset.status === "confirmed" ? "confirmed" : old.state,
            updatedAt: r.updatedAt,
          });
        else
          await store.putMedia({
            id: asset.id,
            itemId: r.id,
            ownerId: r.ownerId,
            role: asset.role,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            sha256: asset.sha256,
            localPath: artworkPath,
            remoteId: asset.id,
            state: asset.status === "confirmed" ? "confirmed" : "pending",
            uploadUrl: null,
            uploadHeaders: null,
            lastError: null,
            createdAt: asset.createdAt,
            updatedAt: r.updatedAt,
          });
      }
    }
  }
  private async enqueueBoundDrafts(ownerId: string) {
    const store = this.requireStore();
    for (const item of await store.listItems(true)) {
      if (item.ownerId !== ownerId || item.captureState !== "saved") continue;
      const pending = await store.listOperationsForItem(item.id);
      if (
        item.version === null &&
        !pending.some((op) => op.kind === "upsert_item")
      )
        await store.putOperation({
          id: this.runtime.id(),
          ownerId,
          kind: "upsert_item",
          itemId: item.id,
          mediaId: null,
          payload: {
            create: true,
            body: {
              category: item.category,
              title: item.title ?? "",
              notes: item.notes ?? "",
              sessionId: item.sessionId,
              capturedAt: item.capturedAt,
            },
          },
          attempts: 0,
          nextAttemptAt: this.runtime.now(),
          lastError: null,
          createdAt: this.runtime.now(),
          updatedAt: this.runtime.now(),
        });
      for (const media of await store.listMediaForItem(item.id))
        if (
          media.state === "pending" &&
          (media.role === "original" || media.role === "detail") &&
          !pending.some((op) => op.mediaId === media.id)
        )
          await store.putOperation({
            id: this.runtime.id(),
            ownerId,
            kind: "upload_media",
            itemId: item.id,
            mediaId: media.id,
            payload: {},
            attempts: 0,
            nextAttemptAt: this.runtime.now(),
            lastError: null,
            createdAt: this.runtime.now(),
            updatedAt: this.runtime.now(),
          });
    }
  }
  private async toUi(item: LocalItem): Promise<CollectionItem> {
    const media = await this.requireStore().listMediaForItem(item.id);
    const originals = media.filter(
      (x) => x.role === "original" || x.role === "detail",
    );
    const artwork = media
      .filter((x) => x.role === "artwork" && x.localPath)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const recognitionStatus =
      item.recognitionStatus === "needs_review"
        ? "review"
        : item.recognitionStatus === "pending"
          ? "processing"
          : item.recognitionStatus;
    return {
      id: item.id,
      category: item.category,
      title: item.title,
      editionName: item.editionName,
      editionId: item.editionId,
      artworkUri:
        item.artworkStatus === "ready" ? (artwork?.localPath ?? null) : null,
      artworkStatus: item.artworkStatus,
      notes: item.notes,
      sessionId: item.sessionId,
      deletedAt: item.deletedAt,
      photoUri: originals[0]?.localPath ?? null,
      additionalPhotoUris: originals
        .slice(1)
        .map((x) => x.localPath)
        .filter((x): x is string => !!x),
      addedAt: item.capturedAt,
      uploadStatus:
        item.syncState === "synced"
          ? "synced"
          : item.syncState === "error"
            ? "attention"
            : item.syncState === "pending"
              ? "syncing"
              : "local",
      recognitionStatus,
    };
  }
  private requireStore() {
    if (!this.store) throw new Error("Data layer not initialized");
    return this.store;
  }
  private async emit() {
    for (const listener of this.listeners) listener();
  }
}
let singleton: DataLayer | null = null;
export function getDataLayer() {
  singleton ??= new DataLayer();
  return singleton;
}
export * from "./types";
