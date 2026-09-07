import type { FilePort, LocalStore, RuntimePort } from "./ports";
import type {
  CaptureSession,
  ItemCategory,
  LocalItem,
  LocalMedia,
  SyncOperation,
} from "./types";

const operation = (
  runtime: RuntimePort,
  kind: SyncOperation["kind"],
  itemId: string,
  mediaId: string | null,
  ownerId: string | null,
  payload: Record<string, unknown> = {},
): SyncOperation => {
  const now = runtime.now();
  return {
    id: runtime.id(),
    ownerId,
    kind,
    itemId,
    mediaId,
    payload,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
};

export class CaptureCoordinator {
  constructor(
    private readonly store: LocalStore,
    private readonly files: FilePort,
    private readonly runtime: RuntimePort,
  ) {}

  async startSession(
    title: string | null = null,
    ownerId: string | null = null,
  ): Promise<CaptureSession> {
    const session: CaptureSession = {
      id: this.runtime.id(),
      ownerId,
      title,
      startedAt: this.runtime.now(),
      endedAt: null,
    };
    await this.store.putSession(session);
    return session;
  }

  /** The file is durable before the item is reported as saved. */
  async saveNew(
    sourceUri: string,
    input: {
      category: ItemCategory;
      title?: string | null;
      editionName?: string | null;
      notes?: string | null;
      sessionId?: string | null;
      capturedAt?: string;
      mimeType?: string;
      ownerId?: string | null;
    },
  ): Promise<LocalItem> {
    const now = this.runtime.now();
    const itemId = this.runtime.id();
    const mediaId = this.runtime.id();
    const item: LocalItem = {
      id: itemId,
      ownerId: input.ownerId ?? null,
      category: input.category,
      title: input.title ?? null,
      editionName: input.editionName ?? null,
      editionId: null,
      notes: input.notes ?? null,
      sessionId: input.sessionId ?? null,
      capturedAt: input.capturedAt ?? now,
      version: null,
      recognitionStatus: "unassigned",
      artworkStatus: "pending",
      captureState: "preparing",
      syncState: "local_only",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const stableName = `${mediaId}.original`;
    const provisional: LocalMedia = {
      id: mediaId,
      itemId,
      ownerId: item.ownerId,
      role: "original",
      mimeType: input.mimeType ?? "image/jpeg",
      byteSize: 0,
      sha256: "",
      localPath: this.files.originalPath(stableName),
      remoteId: null,
      state: "local",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.transaction(async () => {
      await this.store.putItem(item);
      await this.store.putMedia(provisional);
    }); // durable association before filesystem move
    try {
      const file = await this.files.moveToOriginal(sourceUri, stableName);
      if (
        !file.path ||
        file.byteSize <= 0 ||
        !(await this.files.info(file.path)).exists
      )
        throw new Error("Original photo was not persisted");
      const saved = {
        ...item,
        captureState: "saved" as const,
        syncState: item.ownerId
          ? ("pending" as const)
          : ("local_only" as const),
        updatedAt: this.runtime.now(),
      };
      const media: LocalMedia = {
        ...provisional,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sha256: file.sha256,
        localPath: file.path,
        state: item.ownerId ? "pending" : "local",
        updatedAt: this.runtime.now(),
      };
      await this.store.transaction(async () => {
        await this.store.putItem(saved);
        await this.store.putMedia(media);
        if (saved.ownerId) {
          await this.store.putOperation(
            operation(
              this.runtime,
              "upsert_item",
              itemId,
              null,
              saved.ownerId,
              {
                create: true,
                body: {
                  category: saved.category,
                  title: saved.title ?? "",
                  notes: saved.notes ?? "",
                  sessionId: saved.sessionId,
                  capturedAt: saved.capturedAt,
                },
              },
            ),
          );
          await this.store.putOperation(
            operation(
              this.runtime,
              "upload_media",
              itemId,
              mediaId,
              saved.ownerId,
            ),
          );
        }
      });
      return saved;
    } catch (error) {
      const failed = {
        ...item,
        captureState: "capture_failed" as const,
        syncState: "error" as const,
        updatedAt: this.runtime.now(),
      };
      await this.store.putItem(failed);
      throw error;
    }
  }

  async attachPhoto(
    itemId: string,
    sourceUri: string,
    ownerId: string | null,
    role: LocalMedia["role"] = "detail",
  ): Promise<LocalMedia> {
    const item = await this.store.getItem(itemId);
    if (!item || item.deletedAt) throw new Error("Item is unavailable");
    const now = this.runtime.now();
    const mediaId = this.runtime.id(),
      stableName = `${mediaId}.original`;
    const provisional: LocalMedia = {
      id: mediaId,
      itemId,
      ownerId,
      role,
      mimeType: "image/jpeg",
      byteSize: 0,
      sha256: "",
      localPath: this.files.originalPath(stableName),
      remoteId: null,
      state: "local",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putMedia(provisional);
    const file = await this.files.moveToOriginal(sourceUri, stableName);
    if (file.byteSize <= 0 || !(await this.files.info(file.path)).exists)
      throw new Error("Original photo was not persisted");
    const media: LocalMedia = {
      ...provisional,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      sha256: file.sha256,
      localPath: file.path,
      state: ownerId ? "pending" : "local",
      updatedAt: now,
    };
    await this.store.transaction(async () => {
      await this.store.putMedia(media);
      if (ownerId)
        await this.store.putOperation(
          operation(this.runtime, "upload_media", itemId, mediaId, ownerId),
        );
    });
    return media;
  }

  /** Repairs records interrupted between the file move and SQLite commit. */
  async recover(): Promise<void> {
    for (const item of await this.store.listItems(true)) {
      const media = await this.store.listMediaForItem(item.id);
      const provisional = media.filter(
        (entry) => !entry.byteSize || !entry.sha256,
      );
      if (item.captureState === "saved" && !provisional.length) continue;

      const repaired = new Map<string, LocalMedia>();
      const attention = new Map<string, LocalMedia>();
      for (const entry of provisional) {
        if (!entry.localPath) {
          attention.set(
            entry.id,
            this.needsAttention(entry, "Файл оригинала не найден"),
          );
          continue;
        }
        try {
          const info = await this.files.info(entry.localPath);
          if (!info.exists || !info.size) {
            attention.set(
              entry.id,
              this.needsAttention(entry, "Файл оригинала не найден"),
            );
            continue;
          }
          // ExpoFiles leaves an already-stable file in place and derives its
          // checksum and MIME type. This also works after a crash just before
          // SQLite receives the final metadata.
          const file = await this.files.moveToOriginal(
            entry.localPath,
            `${entry.id}.original`,
          );
          repaired.set(entry.id, {
            ...entry,
            localPath: file.path,
            byteSize: file.byteSize,
            sha256: file.sha256,
            mimeType: file.mimeType,
            state: item.ownerId ? "pending" : "local",
            lastError: null,
            updatedAt: this.runtime.now(),
          });
        } catch (error) {
          // A corrupt or unsupported photo is still a user file. Keep its
          // path and surface the problem instead of making startup fail.
          attention.set(
            entry.id,
            this.needsAttention(entry, this.errorMessage(error)),
          );
        }
      }

      let current = media.map(
        (entry) => repaired.get(entry.id) ?? attention.get(entry.id) ?? entry,
      );
      const original = current.find((entry) => entry.role === "original");
      let originalUsable = false;
      if (
        original?.localPath &&
        original.byteSize > 0 &&
        !!original.sha256 &&
        original.state !== "needs_attention"
      ) {
        try {
          originalUsable = (await this.files.info(original.localPath)).exists;
        } catch (error) {
          attention.set(
            original.id,
            this.needsAttention(original, this.errorMessage(error)),
          );
        }
      } else if (original && original.state !== "needs_attention") {
        attention.set(
          original.id,
          this.needsAttention(original, "Файл оригинала не найден"),
        );
      }
      current = media.map(
        (entry) => repaired.get(entry.id) ?? attention.get(entry.id) ?? entry,
      );
      const saved = {
        ...item,
        captureState: originalUsable
          ? ("saved" as const)
          : ("capture_failed" as const),
      };

      await this.store.transaction(async () => {
        for (const entry of current) await this.store.putMedia(entry);
        const hasAttention = attention.size > 0;
        await this.store.putItem({
          ...saved,
          syncState:
            saved.captureState === "saved" && saved.ownerId
              ? hasAttention
                ? "error"
                : "pending"
              : saved.captureState === "capture_failed"
                ? "error"
                : saved.syncState,
          updatedAt: this.runtime.now(),
        });
        if (saved.captureState !== "saved" || !saved.ownerId) return;
        const operations = await this.store.listOperationsForItem(saved.id);
        const hasOperation = (
          kind: SyncOperation["kind"],
          mediaId: string | null,
        ) =>
          operations.some(
            (entry) => entry.kind === kind && entry.mediaId === mediaId,
          );
        if (saved.version === null && !hasOperation("upsert_item", null)) {
          await this.store.putOperation(
            operation(
              this.runtime,
              "upsert_item",
              saved.id,
              null,
              saved.ownerId,
              {
                create: true,
                body: {
                  category: saved.category,
                  title: saved.title ?? "",
                  notes: saved.notes ?? "",
                  sessionId: saved.sessionId,
                  capturedAt: saved.capturedAt,
                },
              },
            ),
          );
        }
        for (const entry of current) {
          if (
            !entry.byteSize ||
            !entry.sha256 ||
            entry.state === "needs_attention" ||
            entry.remoteId ||
            hasOperation("upload_media", entry.id)
          )
            continue;
          await this.store.putOperation(
            operation(
              this.runtime,
              "upload_media",
              saved.id,
              entry.id,
              saved.ownerId,
            ),
          );
        }
      });
    }
  }

  private needsAttention(media: LocalMedia, reason: string): LocalMedia {
    return {
      ...media,
      state: "needs_attention",
      lastError: reason,
      updatedAt: this.runtime.now(),
    };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error && error.message
      ? error.message
      : "Не удалось проверить оригинал";
  }
}
