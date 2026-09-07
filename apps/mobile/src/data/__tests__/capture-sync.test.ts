import { describe, expect, it } from "vitest";
import { CaptureCoordinator } from "../capture";
import { SyncCoordinator } from "../sync";
import type { FilePort, HttpPort, LocalStore, RuntimePort } from "../ports";
import type {
  CaptureSession,
  LocalItem,
  LocalMedia,
  SyncOperation,
} from "../types";
import {
  belongsToCurrentOwner,
  mayApplyRemoteSnapshot,
} from "../snapshot-policy";

class MemoryStore implements LocalStore {
  items = new Map<string, LocalItem>();
  media = new Map<string, LocalMedia>();
  operations = new Map<string, SyncOperation>();
  sessions = new Map<string, CaptureSession>();
  transactionCount = 0;
  failTransactionAt: number | null = null;
  async transaction<T>(work: () => Promise<T>) {
    this.transactionCount++;
    if (this.transactionCount === this.failTransactionAt)
      throw new Error("SIMULATED_SQLITE_COMMIT_FAILURE");
    return work();
  }
  async getItem(id: string) {
    return this.items.get(id) ?? null;
  }
  async listItems(includeDeleted = false) {
    return [...this.items.values()].filter(
      (x) => includeDeleted || !x.deletedAt,
    );
  }
  async putItem(x: LocalItem) {
    this.items.set(x.id, x);
  }
  async getMedia(id: string) {
    return this.media.get(id) ?? null;
  }
  async listMediaForItem(id: string) {
    return [...this.media.values()].filter((x) => x.itemId === id);
  }
  async putMedia(x: LocalMedia) {
    this.media.set(x.id, x);
  }
  async listSessions() {
    return [...this.sessions.values()];
  }
  async putSession(x: CaptureSession) {
    this.sessions.set(x.id, x);
  }
  async getOperation(id: string) {
    return this.operations.get(id) ?? null;
  }
  async listOperationsForItem(id: string) {
    return [...this.operations.values()].filter((x) => x.itemId === id);
  }
  async listReadyOperations(owner: string | null, now: string, limit: number) {
    return [...this.operations.values()]
      .filter(
        (x, i, all) =>
          x.ownerId === owner &&
          x.nextAttemptAt <= now &&
          !all.slice(0, i).some((previous) => previous.itemId === x.itemId),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }
  async putOperation(x: SyncOperation) {
    this.operations.set(x.id, x);
  }
  async deleteOperation(id: string) {
    this.operations.delete(id);
  }
  async bindUnownedDrafts(owner: string) {
    for (const x of this.items.values())
      if (!x.ownerId) {
        x.ownerId = owner;
        x.syncState = "pending";
      }
  }
}
const runtime = (): RuntimePort => {
  let id = 0;
  return {
    now: () => "2026-09-05T00:00:00.000Z",
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  };
};
const file = (exists = true): FilePort => ({
  originalPath: (name: string) => `file://${name}`,
  moveToOriginal: async () => ({
    path: "file://original.jpg",
    byteSize: 42,
    sha256: "a".repeat(64),
    mimeType: "image/jpeg" as const,
  }),
  info: async () => ({ exists, size: exists ? 42 : 0 }),
  read: async () => new Blob(["x"]),
  remove: async () => {},
});

describe("capture coordinator", () => {
  it("does not report a capture as saved before the original exists", async () => {
    const store = new MemoryStore();
    const r = runtime();
    const c = new CaptureCoordinator(store, file(false), r);
    await expect(
      c.saveNew("tmp://photo", { category: "energy" }),
    ).rejects.toThrow("persisted");
    const item = [...store.items.values()][0];
    expect(item?.captureState).toBe("capture_failed");
    expect(store.media.size).toBe(1);
  });
  it("keeps one stable item and durable original when a capture is saved", async () => {
    const store = new MemoryStore();
    const c = new CaptureCoordinator(store, file(), runtime());
    const item = await c.saveNew("tmp://photo", {
      category: "pringles",
      ownerId: "owner",
    });
    expect(item.captureState).toBe("saved");
    expect(item.id).toHaveLength(36);
    expect((await store.listMediaForItem(item.id))[0]?.localPath).toBe(
      "file://original.jpg",
    );
    expect([...store.operations.values()].map((x) => x.kind)).toEqual([
      "upsert_item",
      "upload_media",
    ]);
  });
  it("recovers the same provisional item and media after a crash following the file move", async () => {
    const store = new MemoryStore();
    const r = runtime(),
      itemId = r.id(),
      mediaId = r.id();
    const interrupted: LocalItem = {
      id: itemId,
      ownerId: "owner",
      category: "energy",
      title: null,
      editionName: null,
      editionId: null,
      notes: null,
      sessionId: null,
      capturedAt: r.now(),
      version: null,
      recognitionStatus: "unassigned",
      artworkStatus: "pending",
      captureState: "preparing",
      syncState: "local_only",
      deletedAt: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    const provisional: LocalMedia = {
      id: mediaId,
      itemId,
      ownerId: "owner",
      role: "original",
      mimeType: "image/jpeg",
      byteSize: 0,
      sha256: "",
      localPath: `file://${mediaId}.original`,
      remoteId: null,
      state: "local",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    await store.putItem(interrupted);
    await store.putMedia(provisional);
    const port: FilePort = {
      originalPath: (name) => `file://${name}`,
      moveToOriginal: async (_source, name) => ({
        path: `file://${name}`,
        byteSize: 7,
        sha256: "b".repeat(64),
        mimeType: "image/png",
      }),
      info: async () => ({ exists: true, size: 7 }),
      read: async () => new Blob(["x"]),
      remove: async () => {},
    };
    const c = new CaptureCoordinator(store, port, r);
    await c.recover();
    await c.recover();
    const recovered = await store.getItem(itemId),
      media = await store.getMedia(mediaId);
    expect(recovered?.captureState).toBe("saved");
    expect(media?.id).toBe(mediaId);
    expect(media?.sha256).toBe("b".repeat(64));
    expect(media?.mimeType).toBe("image/png");
    expect(
      [...store.operations.values()].filter((x) => x.kind === "upload_media"),
    ).toHaveLength(1);
  });
  it("preserves the detected PNG MIME type in collection media", async () => {
    const store = new MemoryStore();
    const r = runtime();
    const port: FilePort = {
      originalPath: (name) => `file://${name}`,
      moveToOriginal: async (_source, name) => ({
        path: `file://${name}`,
        byteSize: 3,
        sha256: "c".repeat(64),
        mimeType: "image/png",
      }),
      info: async () => ({ exists: true, size: 3 }),
      read: async () => new Blob(["x"]),
      remove: async () => {},
    };
    const item = await new CaptureCoordinator(store, port, r).saveNew(
      "tmp://png",
      { category: "energy" },
    );
    expect((await store.listMediaForItem(item.id))[0]?.mimeType).toBe(
      "image/png",
    );
  });
  it("repairs a file that moved before saveNew's final database transaction", async () => {
    const store = new MemoryStore();
    store.failTransactionAt = 2;
    const c = new CaptureCoordinator(store, file(), runtime());
    await expect(
      c.saveNew("tmp://photo", { category: "energy", ownerId: "owner" }),
    ).rejects.toThrow("SIMULATED_SQLITE_COMMIT_FAILURE");

    const interrupted = [...store.items.values()][0];
    if (!interrupted)
      throw new Error("Expected the interrupted capture record");
    expect(interrupted.captureState).toBe("capture_failed");
    expect((await store.listMediaForItem(interrupted.id))[0]?.byteSize).toBe(0);

    await c.recover();
    await c.recover();
    expect((await store.getItem(interrupted.id))?.captureState).toBe("saved");
    expect(
      [...store.operations.values()].map((entry) => [
        entry.kind,
        entry.mediaId,
      ]),
    ).toEqual([
      ["upsert_item", null],
      ["upload_media", (await store.listMediaForItem(interrupted.id))[0]!.id],
    ]);
  });
  it("repairs an interrupted extra angle without creating duplicate upload work", async () => {
    const store = new MemoryStore();
    const r = runtime();
    const item: LocalItem = {
      id: r.id(),
      ownerId: "owner",
      category: "energy",
      title: null,
      editionName: null,
      editionId: null,
      notes: null,
      sessionId: null,
      capturedAt: r.now(),
      version: 1,
      recognitionStatus: "unassigned",
      artworkStatus: "pending",
      captureState: "saved",
      syncState: "synced",
      deletedAt: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    const original: LocalMedia = {
      id: r.id(),
      itemId: item.id,
      ownerId: "owner",
      role: "original",
      mimeType: "image/jpeg",
      byteSize: 42,
      sha256: "a".repeat(64),
      localPath: "file://original.jpg",
      remoteId: "remote-original",
      state: "confirmed",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    await store.putItem(item);
    await store.putMedia(original);
    store.failTransactionAt = 1;
    const c = new CaptureCoordinator(store, file(), r);
    await expect(
      c.attachPhoto(item.id, "tmp://detail", "owner"),
    ).rejects.toThrow("SIMULATED_SQLITE_COMMIT_FAILURE");
    store.failTransactionAt = null;

    await c.recover();
    await c.recover();
    const media = await store.listMediaForItem(item.id);
    const detail = media.find((entry) => entry.role === "detail");
    expect(detail?.byteSize).toBe(42);
    expect(detail?.state).toBe("pending");
    expect(
      [...store.operations.values()].filter(
        (entry) =>
          entry.kind === "upload_media" && entry.mediaId === detail?.id,
      ),
    ).toHaveLength(1);
  });
  it("keeps a missing provisional original for attention instead of failing recovery", async () => {
    const store = new MemoryStore();
    const r = runtime();
    const c = new CaptureCoordinator(store, file(false), r);
    const item: LocalItem = {
      id: r.id(),
      ownerId: null,
      category: "energy",
      title: null,
      editionName: null,
      editionId: null,
      notes: null,
      sessionId: null,
      capturedAt: r.now(),
      version: null,
      recognitionStatus: "unassigned",
      artworkStatus: "pending",
      captureState: "preparing",
      syncState: "local_only",
      deletedAt: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    const media: LocalMedia = {
      id: r.id(),
      itemId: item.id,
      ownerId: null,
      role: "original",
      mimeType: "image/jpeg",
      byteSize: 0,
      sha256: "",
      localPath: "file://missing.jpg",
      remoteId: null,
      state: "local",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    await store.putItem(item);
    await store.putMedia(media);
    await expect(c.recover()).resolves.toBeUndefined();
    expect((await store.getItem(item.id))?.captureState).toBe("capture_failed");
    expect((await store.getMedia(media.id))?.state).toBe("needs_attention");
    expect((await store.getMedia(media.id))?.localPath).toBe(
      "file://missing.jpg",
    );
  });
});

describe("snapshot policy", () => {
  it("isolates accounts while retaining only unsigned drafts", () => {
    expect(belongsToCurrentOwner("account-a", "account-a")).toBe(true);
    expect(belongsToCurrentOwner("account-b", "account-a")).toBe(false);
    expect(belongsToCurrentOwner(null, "account-a")).toBe(true);
    expect(belongsToCurrentOwner("account-a", null)).toBe(false);
  });
  it("does not let a snapshot overwrite a pending local edit or deletion", () => {
    expect(mayApplyRemoteSnapshot(null)).toBe(true);
    expect(mayApplyRemoteSnapshot({ syncState: "synced" } as LocalItem)).toBe(
      true,
    );
    expect(mayApplyRemoteSnapshot({ syncState: "pending" } as LocalItem)).toBe(
      false,
    );
    expect(mayApplyRemoteSnapshot({ syncState: "error" } as LocalItem)).toBe(
      false,
    );
  });
});

describe("sync coordinator", () => {
  it("retries a lost create response with the same operation and immutable request body", async () => {
    const store = new MemoryStore();
    const r = runtime();
    const item: LocalItem = {
      id: r.id(),
      ownerId: "owner",
      category: "energy",
      title: "Original",
      editionName: null,
      editionId: null,
      notes: null,
      sessionId: null,
      capturedAt: r.now(),
      version: null,
      recognitionStatus: "unassigned",
      artworkStatus: "pending",
      captureState: "saved",
      syncState: "pending",
      deletedAt: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    await store.putItem(item);
    const op: SyncOperation = {
      id: r.id(),
      ownerId: "owner",
      kind: "upsert_item",
      itemId: item.id,
      mediaId: null,
      payload: {
        create: true,
        body: {
          category: "energy",
          title: "Original",
          notes: "",
          sessionId: null,
          capturedAt: item.capturedAt,
        },
      },
      attempts: 0,
      nextAttemptAt: r.now(),
      lastError: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    await store.putOperation(op);
    let calls = 0;
    const bodies: unknown[] = [];
    const http: HttpPort = {
      request: async <T>(
        _m: "GET" | "POST" | "PUT" | "PATCH",
        _p: string,
        body?: unknown,
      ) => {
        calls++;
        bodies.push(body);
        if (calls === 1) throw new Error("NETWORK");
        return {
          id: item.id,
          ownerId: "owner",
          category: "energy",
          title: "Original",
          notes: "",
          sessionId: null,
          editionId: null,
          edition: null,
          version: 1,
          inputRevision: 0,
          capturedAt: item.capturedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          deletedAt: null,
          recognitionStatus: "unassigned",
          artworkStatus: "pending",
          media: [],
          candidates: [],
        } as T;
      },
      upload: async () => {},
      mediaUrl: () => "",
    };
    const sync = new SyncCoordinator(store, http, file(), r);
    await sync.run("owner");
    await store.putItem({ ...item, title: "Edited after response loss" });
    const retried = await store.getOperation(op.id);
    await store.putOperation({ ...retried!, nextAttemptAt: r.now() });
    await sync.run("owner");
    expect(calls).toBe(3);
    expect((bodies[1] as any).title).toBe("Original");
    expect((bodies[1] as any).operationId).toBe((bodies[0] as any).operationId);
    expect((bodies[2] as any).title).toBe("Edited after response loss");
    expect((bodies[2] as any).operationId).not.toBe(
      (bodies[0] as any).operationId,
    );
    expect(await store.getOperation(op.id)).toBeNull();
    expect((await store.getItem(item.id))?.title).toBe(
      "Edited after response loss",
    );
  });
  it("retries a lost media confirmation with the same confirmation id", async () => {
    const store = new MemoryStore();
    const r = runtime();
    const item: LocalItem = {
      id: r.id(),
      ownerId: "owner",
      category: "energy",
      title: null,
      editionName: null,
      editionId: null,
      notes: null,
      sessionId: null,
      capturedAt: r.now(),
      version: 1,
      recognitionStatus: "unassigned",
      artworkStatus: "pending",
      captureState: "saved",
      syncState: "pending",
      deletedAt: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    const media: LocalMedia = {
      id: r.id(),
      itemId: item.id,
      ownerId: "owner",
      role: "original",
      mimeType: "image/jpeg",
      byteSize: 1,
      sha256: "a".repeat(64),
      localPath: "file://x",
      remoteId: r.id(),
      state: "uploading",
      uploadUrl: null,
      uploadHeaders: null,
      lastError: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    const op: SyncOperation = {
      id: r.id(),
      ownerId: "owner",
      kind: "confirm_media",
      itemId: item.id,
      mediaId: media.id,
      payload: { remoteId: media.remoteId },
      attempts: 0,
      nextAttemptAt: r.now(),
      lastError: null,
      createdAt: r.now(),
      updatedAt: r.now(),
    };
    await store.putItem(item);
    await store.putMedia(media);
    await store.putOperation(op);
    const ids: string[] = [];
    let calls = 0;
    const http: HttpPort = {
      request: async <T>(_m: any, _p: any, body?: any) => {
        ids.push(body.operationId);
        if (++calls === 1) throw new Error("NETWORK");
        return {} as T;
      },
      upload: async () => {},
      mediaUrl: () => "",
    };
    const sync = new SyncCoordinator(store, http, file(), r);
    await sync.run("owner", 1);
    const retry = (await store.getOperation(op.id))!;
    await store.putOperation({ ...retry, nextAttemptAt: r.now() });
    await sync.run("owner", 1);
    expect(ids).toEqual([op.id, op.id]);
    expect((await store.getMedia(media.id))?.state).toBe("confirmed");
  });
});
