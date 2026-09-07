import { z } from "zod";

export const API_VERSION = "v1";
export const ARCHIVE_VERSION = 1;
export const categorySchema = z.enum(["energy", "pringles"]);
export type Category = z.infer<typeof categorySchema>;
export const CATEGORY_LABELS: Record<Category, string> = {
  energy: "Энергетики",
  pringles: "Pringles",
};
export const uuidSchema = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable();
export const credentialSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.trim().toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
export const userSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  role: z.enum(["collector", "editor"]).optional(),
});
export type User = z.infer<typeof userSchema>;
export const authResponseSchema = z.object({
  token: z.string().min(16),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const editionInputSchema = z
  .object({
    category: categorySchema,
    brand: text(120).min(1),
    name: text(200).min(1),
    line: optionalText(120).default(null),
    flavor: optionalText(120).default(null),
    market: optionalText(120).default(null),
    manufacturedIn: optionalText(120).default(null),
    quantity: optionalText(80).default(null),
    design: optionalText(500).default(null),
    series: optionalText(160).default(null),
    barcodes: z
      .array(z.string().regex(/^\d{8,14}$/))
      .max(30)
      .default([]),
    evidence: text(2000).default(""),
  })
  .strict();
export type EditionInput = z.infer<typeof editionInputSchema>;
export const editionSchema = editionInputSchema.extend({
  id: uuidSchema,
  productId: uuidSchema,
  status: z.enum(["draft", "confirmed", "merged", "archived"]),
  mergedIntoId: uuidSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Edition = z.infer<typeof editionSchema>;

export const mediaRoleSchema = z.enum([
  "original",
  "detail",
  "artwork",
  "thumbnail",
]);
export type MediaRole = z.infer<typeof mediaRoleSchema>;
export const mediaSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  role: mediaRoleSchema,
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string(),
  status: z.enum(["pending", "confirmed"]),
  createdAt: z.string(),
  contentUrl: z.string().optional(),
});
export type MediaAsset = z.infer<typeof mediaSchema>;
export const recognitionStatusSchema = z.enum([
  "unassigned",
  "pending",
  "processing",
  "needs_review",
  "proposed",
  "confirmed",
  "failed",
  "outcome_unknown",
]);
export const artworkStatusSchema = z.enum([
  "pending",
  "processing",
  "ready",
  "failed",
  "outcome_unknown",
]);
export const candidateSchema = z.object({
  editionId: uuidSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  edition: editionSchema.optional(),
});
export type RecognitionCandidate = z.infer<typeof candidateSchema>;

export const itemSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  category: categorySchema,
  title: z.string(),
  notes: z.string(),
  sessionId: uuidSchema.nullable(),
  editionId: uuidSchema.nullable(),
  edition: editionSchema.nullable(),
  version: z.number().int().positive(),
  inputRevision: z.number().int().nonnegative(),
  capturedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  recognitionStatus: recognitionStatusSchema,
  artworkStatus: artworkStatusSchema,
  media: z.array(mediaSchema),
  candidates: z.array(candidateSchema),
});
export type Item = z.infer<typeof itemSchema>;

export const operationSchema = z.object({ operationId: uuidSchema }).strict();
export const createItemSchema = operationSchema.extend({
  category: categorySchema,
  title: text(200).default(""),
  notes: text(5000).default(""),
  sessionId: uuidSchema.nullable().default(null),
  capturedAt: z.iso.datetime({ offset: true }),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;
export const updateItemSchema = operationSchema.extend({
  expectedVersion: z.number().int().positive(),
  title: text(200).optional(),
  notes: text(5000).optional(),
  category: categorySchema.optional(),
  editionId: uuidSchema.nullable().optional(),
  deleted: z.boolean().optional(),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export const createMediaSchema = operationSchema.extend({
  id: uuidSchema,
  role: z.enum(["original", "detail"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(30 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type CreateMediaInput = z.infer<typeof createMediaSchema>;
export const uploadTicketSchema = z.object({
  media: mediaSchema,
  uploadUrl: z.string(),
  uploadHeaders: z.record(z.string(), z.string()),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;
export const itemsResponseSchema = z.object({ items: z.array(itemSchema) });
export const editionsResponseSchema = z.object({
  editions: z.array(editionSchema),
});
export const createEditionSchema = editionInputSchema.extend({
  operationId: uuidSchema,
});
export const changeEditionSchema = operationSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export const mergeEditionSchema = changeEditionSchema.extend({
  targetId: uuidSchema,
  reason: text(2000).min(1),
});
export const apiErrorSchema = z
  .object({
    message: z.union([z.string(), z.array(z.string())]),
    statusCode: z.number().optional(),
    code: z.string().optional(),
  })
  .passthrough();

/** Stable payload representation for idempotency keys; object property order is irrelevant. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
