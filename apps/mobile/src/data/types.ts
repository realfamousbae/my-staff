/** Local-first domain records. IDs are generated on the device and never change. */
import type { Category, Item, MediaAsset } from "@my-staff/contracts";

export type ItemCategory = Category;
export type CaptureState = "preparing" | "saved" | "capture_failed";
export type MediaState =
  | "local"
  | "pending"
  | "uploading"
  | "confirmed"
  | "retryable_error"
  | "needs_attention";
export type SyncState =
  "local_only" | "pending" | "syncing" | "synced" | "error";
export type OperationKind =
  "upsert_item" | "upload_media" | "confirm_media" | "process_item";

export interface LocalItem {
  id: string;
  ownerId: string | null;
  category: ItemCategory;
  title: string | null;
  editionName: string | null;
  editionId: string | null;
  notes: string | null;
  sessionId: string | null;
  capturedAt: string;
  version: number | null;
  recognitionStatus:
    | "unassigned"
    | "pending"
    | "processing"
    | "needs_review"
    | "proposed"
    | "confirmed"
    | "failed"
    | "outcome_unknown";
  artworkStatus:
    "pending" | "processing" | "ready" | "failed" | "outcome_unknown";
  captureState: CaptureState;
  syncState: SyncState;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMedia {
  id: string;
  itemId: string;
  ownerId: string | null;
  role: "original" | "detail" | "artwork" | "thumbnail";
  mimeType: string;
  byteSize: number;
  sha256: string;
  localPath: string | null;
  remoteId: string | null;
  state: MediaState;
  uploadUrl: string | null;
  uploadHeaders: Record<string, string> | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureSession {
  id: string;
  ownerId: string | null;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface SyncOperation {
  id: string;
  ownerId: string | null;
  kind: OperationKind;
  itemId: string;
  mediaId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  token: string;
  user: { id: string; email: string };
  /** Token is never sent to a different configured API origin. */
  origin?: string;
}

export type RemoteItem = Item;
export type RemoteMedia = MediaAsset;
