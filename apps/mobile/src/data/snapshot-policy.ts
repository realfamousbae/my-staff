import type { LocalItem } from "./types";

/** A device never exposes another account's local records; unsigned drafts stay visible until binding. */
export const belongsToCurrentOwner = (
  recordOwnerId: string | null,
  currentOwnerId: string | null,
) => recordOwnerId === null || recordOwnerId === currentOwnerId;

/** A server snapshot is read-only evidence and cannot replace a locally queued intent. */
export const mayApplyRemoteSnapshot = (local: LocalItem | null) =>
  local === null || local.syncState === "synced";
