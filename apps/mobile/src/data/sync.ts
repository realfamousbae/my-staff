import type { HttpPort, LocalStore, RuntimePort } from "./ports";
import type { LocalItem, LocalMedia, RemoteItem, SyncOperation } from "./types";

type Allocation = {
  media: { id: string; status?: string };
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
};
const retryAt = (now: string, attempts: number) =>
  new Date(
    new Date(now).getTime() +
      Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)),
  ).toISOString();

export class SyncCoordinator {
  private running: Promise<void> | null = null;
  private runningOwner: string | null = null;
  constructor(
    private readonly store: LocalStore,
    private readonly http: HttpPort,
    private readonly files: { read(path: string): Promise<Blob> },
    private readonly runtime: RuntimePort,
  ) {}

  async run(ownerId: string | null, limit = 20): Promise<void> {
    if (this.running) {
      const sameOwner = this.runningOwner === ownerId;
      await this.running;
      if (sameOwner) return;
      return this.run(ownerId, limit);
    }
    this.runningOwner = ownerId;
    this.running = this.drain(ownerId, limit);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  private async drain(ownerId: string | null, limit: number): Promise<void> {
    if (!ownerId) return;
    let remaining = limit;
    while (remaining > 0) {
      const batch = await this.store.listReadyOperations(
        ownerId,
        this.runtime.now(),
        remaining,
      );
      if (!batch.length) return;
      for (const operation of batch) {
        try {
          await this.execute(operation);
          await this.store.deleteOperation(operation.id);
          await this.updateItemSyncState(operation.itemId);
        } catch (error) {
          await this.fail(operation, error);
        }
        remaining--;
        if (!remaining) return;
      }
    }
  }

  private async execute(operation: SyncOperation): Promise<void> {
    if (operation.kind === "upsert_item") return this.upsert(operation);
    if (operation.kind === "upload_media") return this.upload(operation);
    if (operation.kind === "confirm_media") return this.confirm(operation);
    return this.process(operation);
  }

  private async upsert(
    operation: SyncOperation,
    rebased = false,
  ): Promise<void> {
    const item = await this.requiredItem(operation.itemId, true);
    const body = operation.payload.body as Record<string, unknown> | undefined;
    if (!body) throw new Error("OPERATION_PAYLOAD_MISSING");
    let remote: RemoteItem;
    try {
      remote =
        operation.payload.create === true
          ? await this.http.request<RemoteItem>(
              "PUT",
              `/v1/items/${encodeURIComponent(item.id)}`,
              { operationId: operation.id, ...body },
            )
          : await this.http.request<RemoteItem>(
              "PATCH",
              `/v1/items/${encodeURIComponent(item.id)}`,
              { operationId: operation.id, ...body },
            );
    } catch (error) {
      const conflict = error as Error & {
        current?: RemoteItem;
        status?: number;
      };
      const base = operation.payload.base as
        Record<string, unknown> | undefined;
      const current = conflict.current;
      if (
        !rebased &&
        conflict.status === 409 &&
        conflict.message === "VERSION_CONFLICT" &&
        current &&
        base
      ) {
        const value = (key: string) =>
          key === "deleted"
            ? !!current.deletedAt
            : (current as unknown as Record<string, unknown>)[key];
        const fields = Object.keys(body).filter(
          (key) => key !== "expectedVersion",
        );
        if (
          fields.every(
            (key) => value(key) === base[key] || value(key) === body[key],
          )
        ) {
          // The explicit 409 proves this operation did not commit. It is safe
          // to persist a new version before retrying; a lost response is never rebased.
          const next = {
            ...operation,
            payload: {
              ...operation.payload,
              body: { ...body, expectedVersion: current.version },
            },
            updatedAt: this.runtime.now(),
          };
          await this.store.putOperation(next);
          return this.upsert(next, true);
        }
      }
      throw error;
    }
    const latest = await this.requiredItem(item.id, true);
    await this.store.putItem({
      ...latest,
      ownerId: operation.ownerId,
      version: remote.version,
      recognitionStatus: remote.recognitionStatus,
      artworkStatus: remote.artworkStatus,
      syncState: "pending",
      updatedAt: latest.updatedAt,
    });
    if (operation.payload.create === true) {
      const desired = {
        title: latest.title ?? "",
        notes: latest.notes ?? "",
        category: latest.category,
        editionId: latest.editionId,
      };
      const base = {
        title: remote.title ?? "",
        notes: remote.notes ?? "",
        category: remote.category,
        editionId: remote.editionId,
      };
      const changes = Object.fromEntries(
        Object.entries(desired).filter(
          ([key, value]) => value !== base[key as keyof typeof base],
        ),
      );
      if (Object.keys(changes).length)
        await this.store.putOperation({
          ...operation,
          id: this.runtime.id(),
          payload: {
            create: false,
            body: { expectedVersion: remote.version, ...changes },
            base,
          },
          attempts: 0,
          lastError: null,
          nextAttemptAt: this.runtime.now(),
          createdAt: this.runtime.now(),
          updatedAt: this.runtime.now(),
        });
    }
    if (
      operation.payload.create === true &&
      latest.deletedAt &&
      !remote.deletedAt
    ) {
      await this.store.putOperation({
        ...operation,
        id: this.runtime.id(),
        payload: {
          create: false,
          body: { expectedVersion: remote.version, deleted: true },
          base: { deleted: false },
        },
        attempts: 0,
        lastError: null,
        nextAttemptAt: this.runtime.now(),
        createdAt: this.runtime.now(),
        updatedAt: this.runtime.now(),
      });
    }
  }

  private async upload(operation: SyncOperation): Promise<void> {
    const media = await this.requiredMedia(operation.mediaId);
    if (media.state === "confirmed") return;
    const item = await this.requiredItem(media.itemId, true);
    if (item.deletedAt) return;
    if (!media.localPath) throw new Error("LOCAL_ORIGINAL_MISSING");
    // If a prior create response was lost, PUT with its own stable operation is safe and avoids a new item.
    if (item.version === null) throw new Error("ITEM_NOT_CREATED_YET");
    let allocation: Allocation;
    if (media.remoteId && media.uploadUrl)
      allocation = {
        media: { id: media.remoteId },
        uploadUrl: media.uploadUrl,
        uploadHeaders: media.uploadHeaders ?? {},
      };
    else if (media.remoteId) {
      const ticketOperationId =
        typeof operation.payload.ticketOperationId === "string"
          ? operation.payload.ticketOperationId
          : this.runtime.id();
      if (ticketOperationId !== operation.payload.ticketOperationId)
        await this.store.putOperation({
          ...operation,
          payload: { ...operation.payload, ticketOperationId },
          updatedAt: this.runtime.now(),
        });
      allocation = await this.http.request<Allocation>(
        "POST",
        `/v1/media/${encodeURIComponent(media.remoteId)}/upload-ticket`,
        { operationId: ticketOperationId },
      );
      await this.store.putMedia({
        ...media,
        uploadUrl: allocation.uploadUrl,
        uploadHeaders: allocation.uploadHeaders ?? {},
        state: "uploading",
        updatedAt: this.runtime.now(),
      });
    } else {
      allocation = await this.http.request<Allocation>(
        "POST",
        `/v1/items/${encodeURIComponent(item.id)}/media`,
        {
          id: media.id,
          operationId: operation.id,
          mimeType: media.mimeType,
          byteSize: media.byteSize,
          sha256: media.sha256,
          role: media.role,
        },
      );
      if (allocation.media.status === "confirmed") {
        await this.store.putMedia({
          ...media,
          remoteId: allocation.media.id,
          state: "confirmed",
          uploadUrl: null,
          uploadHeaders: null,
          updatedAt: this.runtime.now(),
        });
        await this.store.putOperation({
          ...operation,
          id: this.runtime.id(),
          kind: "process_item",
          mediaId: null,
          payload: {},
          createdAt: this.runtime.now(),
          updatedAt: this.runtime.now(),
        });
        return;
      }
      await this.store.putMedia({
        ...media,
        remoteId: allocation.media.id,
        uploadUrl: allocation.uploadUrl,
        uploadHeaders: allocation.uploadHeaders ?? {},
        state: "uploading",
        updatedAt: this.runtime.now(),
      });
    }
    await this.http.upload(
      allocation.uploadUrl,
      allocation.uploadHeaders ?? {},
      await this.files.read(media.localPath),
    );
    const updated = await this.requiredMedia(media.id);
    const confirm: SyncOperation = {
      ...operation,
      id: this.runtime.id(),
      kind: "confirm_media",
      mediaId: updated.id,
      payload: { remoteId: updated.remoteId },
      attempts: 0,
      nextAttemptAt: this.runtime.now(),
      lastError: null,
      createdAt: this.runtime.now(),
      updatedAt: this.runtime.now(),
    };
    await this.store.putOperation(confirm);
  }

  private async confirm(operation: SyncOperation): Promise<void> {
    const media = await this.requiredMedia(operation.mediaId);
    if ((await this.requiredItem(media.itemId, true)).deletedAt) return;
    const remoteId = media.remoteId ?? String(operation.payload.remoteId ?? "");
    if (!remoteId) throw new Error("REMOTE_MEDIA_ID_MISSING");
    await this.http.request(
      "POST",
      `/v1/media/${encodeURIComponent(remoteId)}/confirm`,
      { operationId: operation.id },
    );
    await this.store.putMedia({
      ...media,
      state: "confirmed",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      updatedAt: this.runtime.now(),
    });
    const item = await this.requiredItem(media.itemId);
    const process: SyncOperation = {
      ...operation,
      id: this.runtime.id(),
      kind: "process_item",
      mediaId: null,
      payload: {},
      attempts: 0,
      nextAttemptAt: this.runtime.now(),
      lastError: null,
      createdAt: this.runtime.now(),
      updatedAt: this.runtime.now(),
    };
    await this.store.putOperation(process);
    await this.updateItemSyncState(item.id);
  }

  private async process(operation: SyncOperation): Promise<void> {
    const item = await this.requiredItem(operation.itemId, true);
    if (item.deletedAt) return;
    const remote = await this.http.request<RemoteItem>(
      "POST",
      `/v1/items/${encodeURIComponent(operation.itemId)}/process`,
      { operationId: operation.id },
    );
    if (remote.version) {
      const latest = await this.requiredItem(item.id, true);
      await this.store.putItem({
        ...latest,
        version: remote.version,
        recognitionStatus: remote.recognitionStatus,
        artworkStatus: remote.artworkStatus,
      });
    }
    await this.updateItemSyncState(operation.itemId);
  }

  private async updateItemSyncState(itemId: string): Promise<void> {
    const item = await this.requiredItem(itemId, true);
    const media = await this.store.listMediaForItem(itemId);
    const pending = await this.store.listOperationsForItem(itemId);
    const originals = media.filter(
      (entry) => entry.role === "original" || entry.role === "detail",
    );
    const allConfirmed =
      originals.length > 0 &&
      originals.every((entry) => entry.state === "confirmed");
    await this.store.putItem({
      ...item,
      syncState:
        !pending.length && (allConfirmed || !!item.deletedAt)
          ? "synced"
          : pending.some((op) => op.lastError === "VERSION_CONFLICT")
            ? "error"
            : "pending",
      updatedAt: this.runtime.now(),
    });
  }

  private async fail(operation: SyncOperation, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    // `upload` may persist a ticket id before a lost response; never overwrite it with stale in-memory data.
    const current = (await this.store.getOperation(operation.id)) ?? operation;
    const attempts = current.attempts + 1;
    await this.store.putOperation({
      ...current,
      attempts,
      lastError: message,
      nextAttemptAt: retryAt(this.runtime.now(), attempts),
      updatedAt: this.runtime.now(),
    });
    const item = await this.store.getItem(operation.itemId);
    if (item)
      await this.store.putItem({
        ...item,
        syncState: ["LOCAL_ORIGINAL_MISSING", "VERSION_CONFLICT"].includes(
          message,
        )
          ? "error"
          : "pending",
        updatedAt: this.runtime.now(),
      });
    if (operation.mediaId) {
      const media = await this.store.getMedia(operation.mediaId);
      if (media)
        await this.store.putMedia({
          ...media,
          uploadUrl: /^UPLOAD_4/.test(message) ? null : media.uploadUrl,
          uploadHeaders: /^UPLOAD_4/.test(message) ? null : media.uploadHeaders,
          state:
            message === "LOCAL_ORIGINAL_MISSING"
              ? "needs_attention"
              : "retryable_error",
          lastError: message,
          updatedAt: this.runtime.now(),
        });
    }
  }

  private async requiredItem(
    id: string,
    includeDeleted = false,
  ): Promise<LocalItem> {
    const item = await this.store.getItem(id);
    if (!item || (!includeDeleted && item.deletedAt))
      throw new Error("ITEM_UNAVAILABLE");
    return item;
  }
  private async requiredMedia(id: string | null): Promise<LocalMedia> {
    if (!id) throw new Error("MEDIA_REQUIRED");
    const media = await this.store.getMedia(id);
    if (!media) throw new Error("MEDIA_UNAVAILABLE");
    return media;
  }
}
