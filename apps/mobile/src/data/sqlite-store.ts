import * as SQLite from "expo-sqlite";
import type {
  CaptureSession,
  LocalItem,
  LocalMedia,
  SyncOperation,
} from "./types";
import type { LocalStore } from "./ports";

const json = (value: unknown) => (value == null ? null : JSON.stringify(value));
const parse = <T>(value: string | null): T | null =>
  value ? (JSON.parse(value) as T) : null;

export class ExpoSqliteStore implements LocalStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}
  static async open(): Promise<ExpoSqliteStore> {
    const db = await SQLite.openDatabaseAsync("my-staff.db");
    const store = new ExpoSqliteStore(db);
    await store.migrate();
    return store;
  }
  private async migrate() {
    await this.db.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, owner_id TEXT, category TEXT NOT NULL, title TEXT, edition_name TEXT, edition_id TEXT, notes TEXT, session_id TEXT, captured_at TEXT NOT NULL, version INTEGER, recognition_status TEXT NOT NULL, artwork_status TEXT NOT NULL, capture_state TEXT NOT NULL, sync_state TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, owner_id TEXT, role TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, local_path TEXT, remote_id TEXT, state TEXT NOT NULL, upload_url TEXT, upload_headers TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, started_at TEXT NOT NULL, ended_at TEXT);
      CREATE TABLE IF NOT EXISTS sync_operations (id TEXT PRIMARY KEY, owner_id TEXT, kind TEXT NOT NULL, item_id TEXT NOT NULL, media_id TEXT, payload TEXT NOT NULL, attempts INTEGER NOT NULL, next_attempt_at TEXT NOT NULL, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sync_operations_due ON sync_operations(owner_id, next_attempt_at, created_at); CREATE INDEX IF NOT EXISTS media_item ON media(item_id);`);
    const columns = await this.db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(items)",
    );
    if (!columns.some((column) => column.name === "edition_name"))
      await this.db.execAsync("ALTER TABLE items ADD COLUMN edition_name TEXT");
    if (!columns.some((column) => column.name === "edition_id"))
      await this.db.execAsync("ALTER TABLE items ADD COLUMN edition_id TEXT");
    if (!columns.some((column) => column.name === "recognition_status"))
      await this.db.execAsync(
        "ALTER TABLE items ADD COLUMN recognition_status TEXT NOT NULL DEFAULT 'unassigned'",
      );
    if (!columns.some((column) => column.name === "artwork_status"))
      await this.db.execAsync(
        "ALTER TABLE items ADD COLUMN artwork_status TEXT NOT NULL DEFAULT 'pending'",
      );
  }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.db.execAsync("BEGIN IMMEDIATE");
    try {
      const value = await work();
      await this.db.execAsync("COMMIT");
      return value;
    } catch (e) {
      await this.db.execAsync("ROLLBACK");
      throw e;
    }
  }
  async getItem(id: string) {
    return this.mapItem(
      await this.db.getFirstAsync<any>("SELECT * FROM items WHERE id=?", [id]),
    );
  }
  async listItems(includeDeleted = false) {
    return (
      await this.db.getAllAsync<any>(
        `SELECT * FROM items ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY captured_at DESC`,
        [],
      )
    )
      .map(this.mapItem)
      .filter((value): value is LocalItem => value !== null);
  }
  async putItem(x: LocalItem) {
    await this.db.runAsync(
      `INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,category=excluded.category,title=excluded.title,edition_name=excluded.edition_name,edition_id=excluded.edition_id,notes=excluded.notes,session_id=excluded.session_id,captured_at=excluded.captured_at,version=excluded.version,recognition_status=excluded.recognition_status,artwork_status=excluded.artwork_status,capture_state=excluded.capture_state,sync_state=excluded.sync_state,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at`,
      [
        x.id,
        x.ownerId,
        x.category,
        x.title,
        x.editionName,
        x.editionId,
        x.notes,
        x.sessionId,
        x.capturedAt,
        x.version,
        x.recognitionStatus,
        x.artworkStatus,
        x.captureState,
        x.syncState,
        x.deletedAt,
        x.createdAt,
        x.updatedAt,
      ],
    );
  }
  async getMedia(id: string) {
    return this.mapMedia(
      await this.db.getFirstAsync<any>("SELECT * FROM media WHERE id=?", [id]),
    );
  }
  async listMediaForItem(itemId: string) {
    return (
      await this.db.getAllAsync<any>(
        "SELECT * FROM media WHERE item_id=? ORDER BY created_at",
        [itemId],
      )
    )
      .map(this.mapMedia)
      .filter((value): value is LocalMedia => value !== null);
  }
  async putMedia(x: LocalMedia) {
    await this.db.runAsync(
      `INSERT INTO media VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,role=excluded.role,mime_type=excluded.mime_type,byte_size=excluded.byte_size,sha256=excluded.sha256,local_path=excluded.local_path,remote_id=excluded.remote_id,state=excluded.state,upload_url=excluded.upload_url,upload_headers=excluded.upload_headers,last_error=excluded.last_error,updated_at=excluded.updated_at`,
      [
        x.id,
        x.itemId,
        x.ownerId,
        x.role,
        x.mimeType,
        x.byteSize,
        x.sha256,
        x.localPath,
        x.remoteId,
        x.state,
        x.uploadUrl,
        json(x.uploadHeaders),
        x.lastError,
        x.createdAt,
        x.updatedAt,
      ],
    );
  }
  async listSessions() {
    return (
      await this.db.getAllAsync<any>(
        "SELECT * FROM sessions ORDER BY started_at DESC",
      )
    ).map((x) => ({
      id: x.id,
      ownerId: x.owner_id,
      title: x.title,
      startedAt: x.started_at,
      endedAt: x.ended_at,
    }));
  }
  async putSession(x: CaptureSession) {
    await this.db.runAsync(
      "INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,title=excluded.title,ended_at=excluded.ended_at",
      [x.id, x.ownerId, x.title, x.startedAt, x.endedAt],
    );
  }
  async getOperation(id: string) {
    return this.mapOperation(
      await this.db.getFirstAsync<any>(
        "SELECT * FROM sync_operations WHERE id=?",
        [id],
      ),
    );
  }
  async listOperationsForItem(itemId: string) {
    return (
      await this.db.getAllAsync<any>(
        "SELECT * FROM sync_operations WHERE item_id=? ORDER BY rowid",
        [itemId],
      )
    )
      .map(this.mapOperation)
      .filter((value): value is SyncOperation => value !== null);
  }
  async listReadyOperations(
    ownerId: string | null,
    now: string,
    limit: number,
  ) {
    return (
      await this.db.getAllAsync<any>(
        "SELECT s.* FROM sync_operations s WHERE s.owner_id IS ? AND s.next_attempt_at<=? AND NOT EXISTS (SELECT 1 FROM sync_operations previous WHERE previous.item_id=s.item_id AND previous.rowid<s.rowid) ORDER BY s.rowid LIMIT ?",
        [ownerId, now, limit],
      )
    )
      .map(this.mapOperation)
      .filter((value): value is SyncOperation => value !== null);
  }
  async putOperation(x: SyncOperation) {
    await this.db.runAsync(
      `INSERT INTO sync_operations VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,kind=excluded.kind,item_id=excluded.item_id,media_id=excluded.media_id,payload=excluded.payload,attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,last_error=excluded.last_error,updated_at=excluded.updated_at`,
      [
        x.id,
        x.ownerId,
        x.kind,
        x.itemId,
        x.mediaId,
        json(x.payload),
        x.attempts,
        x.nextAttemptAt,
        x.lastError,
        x.createdAt,
        x.updatedAt,
      ],
    );
  }
  async deleteOperation(id: string) {
    await this.db.runAsync("DELETE FROM sync_operations WHERE id=?", [id]);
  }
  async bindUnownedDrafts(ownerId: string) {
    await this.transaction(async () => {
      await this.db.runAsync(
        "UPDATE items SET owner_id=?, sync_state=CASE WHEN capture_state='saved' THEN 'pending' ELSE sync_state END WHERE owner_id IS NULL",
        [ownerId],
      );
      await this.db.runAsync(
        "UPDATE media SET owner_id=?, state=CASE WHEN state='local' THEN 'pending' ELSE state END WHERE owner_id IS NULL",
        [ownerId],
      );
      await this.db.runAsync(
        "UPDATE sessions SET owner_id=? WHERE owner_id IS NULL",
        [ownerId],
      );
    });
  }
  async getSetting(key: string) {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key=?",
      [key],
    );
    return row?.value ?? null;
  }
  async setSetting(key: string, value: string) {
    await this.db.runAsync(
      "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, value],
    );
  }
  private mapItem = (x: any): LocalItem | null =>
    x
      ? {
          id: x.id,
          ownerId: x.owner_id,
          category: x.category,
          title: x.title,
          editionName: x.edition_name ?? null,
          editionId: x.edition_id ?? null,
          notes: x.notes,
          sessionId: x.session_id,
          capturedAt: x.captured_at,
          version: x.version,
          recognitionStatus: x.recognition_status,
          artworkStatus: x.artwork_status,
          captureState: x.capture_state,
          syncState: x.sync_state,
          deletedAt: x.deleted_at,
          createdAt: x.created_at,
          updatedAt: x.updated_at,
        }
      : null;
  private mapMedia = (x: any): LocalMedia | null =>
    x
      ? {
          id: x.id,
          itemId: x.item_id,
          ownerId: x.owner_id,
          role: x.role,
          mimeType: x.mime_type,
          byteSize: x.byte_size,
          sha256: x.sha256,
          localPath: x.local_path,
          remoteId: x.remote_id,
          state: x.state,
          uploadUrl: x.upload_url,
          uploadHeaders: parse(x.upload_headers),
          lastError: x.last_error,
          createdAt: x.created_at,
          updatedAt: x.updated_at,
        }
      : null;
  private mapOperation = (x: any): SyncOperation | null =>
    x
      ? {
          id: x.id,
          ownerId: x.owner_id,
          kind: x.kind,
          itemId: x.item_id,
          mediaId: x.media_id,
          payload: parse<Record<string, unknown>>(x.payload) ?? {},
          attempts: x.attempts,
          nextAttemptAt: x.next_attempt_at,
          lastError: x.last_error,
          createdAt: x.created_at,
          updatedAt: x.updated_at,
        }
      : null;
}
