import { describe, expect, it } from "vitest";
import { SyncCoordinator } from "../sync";
import type { HttpPort, LocalStore, RuntimePort } from "../ports";
import type {
  CaptureSession,
  LocalItem,
  LocalMedia,
  SyncOperation,
} from "../types";
class Store implements LocalStore {
  items = new Map<string, LocalItem>();
  media = new Map<string, LocalMedia>();
  ops = new Map<string, SyncOperation>();
  async transaction<T>(f: () => Promise<T>) {
    return f();
  }
  async getItem(i: string) {
    return this.items.get(i) ?? null;
  }
  async listItems() {
    return [...this.items.values()];
  }
  async putItem(x: LocalItem) {
    this.items.set(x.id, x);
  }
  async getMedia(i: string) {
    return this.media.get(i) ?? null;
  }
  async listMediaForItem(i: string) {
    return [...this.media.values()].filter((x) => x.itemId === i);
  }
  async putMedia(x: LocalMedia) {
    this.media.set(x.id, x);
  }
  async listSessions() {
    return [];
  }
  async putSession(_x: CaptureSession) {}
  async getOperation(i: string) {
    return this.ops.get(i) ?? null;
  }
  async listOperationsForItem(i: string) {
    return [...this.ops.values()].filter((x) => x.itemId === i);
  }
  async listReadyOperations(o: string | null, n: string, l: number) {
    return [...this.ops.values()]
      .filter((x) => x.ownerId === o && x.nextAttemptAt <= n)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, l);
  }
  async putOperation(x: SyncOperation) {
    this.ops.set(x.id, x);
  }
  async deleteOperation(i: string) {
    this.ops.delete(i);
  }
  async bindUnownedDrafts() {}
}
const now = "2026-09-05T00:00:00.000Z";
let n = 0;
const runtime: RuntimePort = {
  now: () => now,
  id: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
};
const item = (id: string, deletedAt: string | null = null): LocalItem => ({
  id,
  ownerId: "owner",
  category: "energy",
  title: "old",
  editionName: null,
  editionId: null,
  notes: "n",
  sessionId: null,
  capturedAt: now,
  version: 1,
  recognitionStatus: "unassigned",
  artworkStatus: "pending",
  captureState: "saved",
  syncState: "pending",
  deletedAt,
  createdAt: now,
  updatedAt: now,
});
const file = { read: async () => new Blob(["x"]) };
describe("sync regressions", () => {
  it("sends a deleted item PATCH", async () => {
    const s = new Store(),
      x = item("i", now),
      op: SyncOperation = {
        id: "o",
        ownerId: "owner",
        kind: "upsert_item",
        itemId: "i",
        mediaId: null,
        payload: {
          create: false,
          body: { expectedVersion: 1, deleted: true },
          base: { deleted: false },
        },
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    await s.putItem(x);
    await s.putOperation(op);
    let body: any;
    const h: HttpPort = {
      request: async (_m, _p, b) => {
        body = b;
        return {
          ...x,
          version: 2,
          deletedAt: now,
          media: [],
          candidates: [],
          edition: null,
          inputRevision: 0,
        } as any;
      },
      upload: async () => {},
      mediaUrl: () => "",
    };
    await new SyncCoordinator(s, h, file, runtime).run("owner");
    expect(body.deleted).toBe(true);
  });
  it("coalesces concurrent runs to one request", async () => {
    const s = new Store(),
      x = item("i"),
      op: SyncOperation = {
        id: "o",
        ownerId: "owner",
        kind: "upsert_item",
        itemId: "i",
        mediaId: null,
        payload: {
          create: false,
          body: { expectedVersion: 1, title: "x" },
          base: { title: "old" },
        },
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    await s.putItem(x);
    await s.putOperation(op);
    let calls = 0;
    const h: HttpPort = {
      request: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return {
          ...x,
          version: 2,
          media: [],
          candidates: [],
          edition: null,
          inputRevision: 0,
        } as any;
      },
      upload: async () => {},
      mediaUrl: () => "",
    };
    const sync = new SyncCoordinator(s, h, file, runtime);
    await Promise.all([sync.run("owner"), sync.run("owner")]);
    expect(calls).toBe(1);
  });
});

describe("conflict settlement", () => {
  it("rebases unchanged fields", async () => {
    const s = new Store(),
      x = item("r"),
      op: SyncOperation = {
        id: "rebase",
        ownerId: "owner",
        kind: "upsert_item",
        itemId: "r",
        mediaId: null,
        payload: {
          create: false,
          body: { expectedVersion: 1, notes: "new" },
          base: { notes: "n" },
        },
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    await s.putItem(x);
    await s.putOperation(op);
    let calls = 0;
    const current = {
      ...x,
      version: 2,
      media: [],
      candidates: [],
      edition: null,
      inputRevision: 0,
    };
    const h: HttpPort = {
      request: async () => {
        if (++calls === 1) {
          const e: any = new Error("VERSION_CONFLICT");
          e.status = 409;
          e.current = current;
          throw e;
        }
        return { ...current, version: 3, notes: "new" } as any;
      },
      upload: async () => {},
      mediaUrl: () => "",
    };
    await new SyncCoordinator(s, h, file, runtime).run("owner");
    expect(calls).toBe(2);
  });
  it("keeps local conflict error", async () => {
    const s = new Store(),
      x = item("c"),
      op: SyncOperation = {
        id: "conflict",
        ownerId: "owner",
        kind: "upsert_item",
        itemId: "c",
        mediaId: null,
        payload: {
          create: false,
          body: { expectedVersion: 1, title: "local" },
          base: { title: "old" },
        },
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    await s.putItem({ ...x, title: "local" });
    await s.putOperation(op);
    const h: HttpPort = {
      request: async () => {
        const e: any = new Error("VERSION_CONFLICT");
        e.status = 409;
        e.current = {
          ...x,
          title: "remote",
          version: 2,
          media: [],
          candidates: [],
          edition: null,
          inputRevision: 0,
        };
        throw e;
      },
      upload: async () => {},
      mediaUrl: () => "",
    };
    await new SyncCoordinator(s, h, file, runtime).run("owner");
    expect((await s.getItem("c"))?.title).toBe("local");
    expect((await s.getItem("c"))?.syncState).toBe("error");
  });
  it("settles metadata with confirmed media", async () => {
    const s = new Store(),
      x = item("m"),
      op: SyncOperation = {
        id: "meta",
        ownerId: "owner",
        kind: "upsert_item",
        itemId: "m",
        mediaId: null,
        payload: {
          create: false,
          body: { expectedVersion: 1, notes: "changed" },
          base: { notes: "n" },
        },
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
      m: LocalMedia = {
        id: "media",
        itemId: "m",
        ownerId: "owner",
        role: "original",
        mimeType: "image/png",
        byteSize: 1,
        sha256: "a".repeat(64),
        localPath: "x",
        remoteId: "r",
        state: "confirmed",
        uploadUrl: null,
        uploadHeaders: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    await s.putItem(x);
    await s.putMedia(m);
    await s.putOperation(op);
    const h: HttpPort = {
      request: async () =>
        ({
          ...x,
          version: 2,
          media: [],
          candidates: [],
          edition: null,
          inputRevision: 0,
        }) as any,
      upload: async () => {},
      mediaUrl: () => "",
    };
    await new SyncCoordinator(s, h, file, runtime).run("owner");
    expect((await s.getItem("m"))?.syncState).toBe("synced");
  });
});
