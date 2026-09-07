import type {
  CaptureSession,
  CollectibleCategory,
  CollectionFilter,
  CollectionItem,
} from "./models";

/** The device repository is implemented separately so screens never depend on SQLite or HTTP details. */
export type CollectionRepository = {
  ready: boolean;
  items: CollectionItem[];
  activeSession?: CaptureSession | null;
  refresh(): Promise<void>;
  createSession(title?: string): Promise<CaptureSession>;
  capture(
    photoUri: string,
    category: CollectibleCategory,
    sessionId?: string,
  ): Promise<CollectionItem>;
  importPhoto(
    photoUri: string,
    category: CollectibleCategory,
    sessionId?: string,
  ): Promise<CollectionItem>;
  updateItem(
    id: string,
    patch: Pick<CollectionItem, "title" | "editionName" | "category" | "notes">,
  ): Promise<void>;
  retry(id: string): Promise<void>;
  filtered(filter: CollectionFilter): CollectionItem[];
  exportCollection?(): Promise<string | null>;
  importCollection?(): Promise<void>;
  clearLocalCache?(): Promise<void>;
};
