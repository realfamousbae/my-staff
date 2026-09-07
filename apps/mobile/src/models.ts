export type CollectibleCategory = "energy" | "pringles";
export type UploadStatus = "local" | "syncing" | "synced" | "attention";
export type RecognitionStatus =
  | "unassigned"
  | "processing"
  | "proposed"
  | "confirmed"
  | "review"
  | "failed"
  | "outcome_unknown";

export type CollectionItem = {
  id: string;
  category: CollectibleCategory;
  title?: string | null;
  editionName?: string | null;
  editionId?: string | null;
  artworkUri?: string | null;
  artworkStatus?:
    "pending" | "processing" | "ready" | "failed" | "outcome_unknown";
  notes?: string | null;
  photoUri?: string | null;
  additionalPhotoUris?: string[];
  sessionId?: string | null;
  deletedAt?: string | null;
  addedAt: string;
  uploadStatus: UploadStatus;
  recognitionStatus: RecognitionStatus;
  proposal?: { title?: string; editionName?: string } | null;
};

export type CaptureSession = {
  id: string;
  title?: string | null;
  startedAt: string;
  itemCount: number;
};
export type CollectionFilter = {
  query?: string;
  category?: CollectibleCategory | "all";
};
