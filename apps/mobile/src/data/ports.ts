import type {
  AuthSession,
  CaptureSession,
  LocalItem,
  LocalMedia,
  SyncOperation,
} from "./types";

export interface LocalStore {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  getItem(id: string): Promise<LocalItem | null>;
  listItems(includeDeleted?: boolean): Promise<LocalItem[]>;
  putItem(item: LocalItem): Promise<void>;
  getMedia(id: string): Promise<LocalMedia | null>;
  listMediaForItem(itemId: string): Promise<LocalMedia[]>;
  putMedia(media: LocalMedia): Promise<void>;
  listSessions(): Promise<CaptureSession[]>;
  putSession(session: CaptureSession): Promise<void>;
  getOperation(id: string): Promise<SyncOperation | null>;
  listOperationsForItem(itemId: string): Promise<SyncOperation[]>;
  listReadyOperations(
    ownerId: string | null,
    now: string,
    limit: number,
  ): Promise<SyncOperation[]>;
  putOperation(operation: SyncOperation): Promise<void>;
  deleteOperation(id: string): Promise<void>;
  bindUnownedDrafts(ownerId: string): Promise<void>;
}

export interface FileInfo {
  exists: boolean;
  size: number;
}
export interface FilePort {
  originalPath(stableName: string): string;
  moveToOriginal(
    sourceUri: string,
    stableName: string,
  ): Promise<{
    path: string;
    byteSize: number;
    sha256: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  }>;
  info(path: string): Promise<FileInfo>;
  read(path: string): Promise<Blob>;
  remove(path: string): Promise<void>;
}

export interface HttpPort {
  request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T>;
  upload(
    url: string,
    headers: Record<string, string>,
    body: Blob,
  ): Promise<void>;
  mediaUrl(mediaId: string): string;
}

export interface SecureSessionPort {
  get(): Promise<AuthSession | null>;
  set(value: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export interface RuntimePort {
  now(): string;
  id(): string;
}
