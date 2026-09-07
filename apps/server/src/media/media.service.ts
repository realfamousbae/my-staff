import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DbService } from "../db/db.service";
import { StorageService } from "../storage/storage.service";
import { CollectionService, mapMedia } from "../collection/collection.service";
import { remember, replay } from "../common/idempotency";
@Injectable()
export class MediaService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(CollectionService) private readonly items: CollectionService,
  ) {}
  async create(
    ownerId: string,
    itemId: string,
    input: {
      id: string;
      operationId: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      role: "original" | "detail";
    },
  ) {
    await this.items.owned(ownerId, itemId);
    return this.db.tx(async (c) => {
      const prior = await replay<any>(
        c,
        ownerId,
        input.operationId,
        "create_media",
        { itemId, input },
      );
      if (prior) return prior;
      const existing = await c.query("SELECT * FROM media_assets WHERE id=$1", [
        input.id,
      ]);
      let media: any;
      if (existing.rowCount) {
        media = existing.rows[0];
        if (media.owner_id !== ownerId || media.item_id !== itemId)
          throw new NotFoundException({
            code: "MEDIA_NOT_FOUND",
            message: "Media not found",
          });
      } else {
        const r = await c.query(
          "INSERT INTO media_assets(id,owner_id,item_id,role,mime_type,byte_size,sha256,object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            input.id,
            ownerId,
            itemId,
            input.role,
            input.mimeType,
            input.byteSize,
            input.sha256,
            `originals/${input.id}`,
          ],
        );
        media = r.rows[0];
      }
      const upload =
        media.state === "confirmed"
          ? { uploadUrl: "", uploadHeaders: {} }
          : await this.storage.uploadUrl(media.id, media.mime_type);
      const out = { media: mapMedia(media), ...upload };
      await remember(
        c,
        ownerId,
        input.operationId,
        "create_media",
        { itemId, input },
        out,
      );
      return out;
    });
  }
  async ticket(ownerId: string, id: string, operationId: string) {
    const r = await this.db.query(
      "SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2 AND state='pending_upload'",
      [id, ownerId],
    );
    if (!r.rowCount)
      throw new NotFoundException({
        code: "MEDIA_NOT_UPLOADABLE",
        message: "Pending media not found",
      });
    return {
      media: mapMedia(r.rows[0]),
      ...(await this.storage.uploadUrl(id, r.rows[0].mime_type)),
    };
  }
  async confirm(ownerId: string, id: string, operationId: string) {
    return this.db.tx(async (c) => {
      const prior = await replay<any>(
        c,
        ownerId,
        operationId,
        "confirm_media",
        { id },
      );
      if (prior) return prior;
      const r = await c.query(
        "SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, ownerId],
      );
      if (!r.rowCount)
        throw new NotFoundException({
          code: "MEDIA_NOT_FOUND",
          message: "Media not found",
        });
      let media = r.rows[0];
      if (media.state !== "confirmed") {
        try {
          await this.storage.confirm(
            id,
            Number(media.byte_size),
            media.sha256,
            media.mime_type,
          );
        } catch (error: any) {
          await c.query(
            "UPDATE media_assets SET state='rejected' WHERE id=$1",
            [id],
          );
          throw new BadRequestException({
            code: "MEDIA_VERIFICATION_FAILED",
            message: error.message,
          });
        }
        const item = await c.query(
          "SELECT id,edition_id FROM collection_items WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [media.item_id, ownerId],
        );
        if (!item.rowCount)
          throw new NotFoundException({
            code: "ITEM_NOT_FOUND",
            message: "Collection item not found",
          });
        const updated = await c.query(
          "UPDATE media_assets SET state='confirmed',immutable_at=now(),confirmed_at=now() WHERE id=$1 RETURNING *",
          [id],
        );
        media = updated.rows[0];
        await c.query(
          "UPDATE collection_items SET input_revision=input_revision+1,version=version+1,recognition_status=CASE WHEN edition_id IS NULL THEN 'pending' ELSE 'confirmed' END,presentation_status='pending',updated_at=now() WHERE id=$1",
          [media.item_id],
        );
      }
      const out = { media: mapMedia(media) };
      await remember(c, ownerId, operationId, "confirm_media", { id }, out);
      return out;
    });
  }
  async upload(ownerId: string, id: string, source: NodeJS.ReadableStream) {
    const r = await this.db.query(
      "SELECT id,state,byte_size FROM media_assets WHERE id=$1 AND owner_id=$2",
      [id, ownerId],
    );
    if (!r.rowCount || r.rows[0].state !== "pending_upload")
      throw new NotFoundException({
        code: "MEDIA_NOT_UPLOADABLE",
        message: "Pending media not found",
      });
    try {
      await this.storage.writePending(id, source, Number(r.rows[0].byte_size));
    } catch (error: any) {
      if (error?.message === "Upload exceeds declared byte size")
        throw new BadRequestException({
          code: "UPLOAD_TOO_LARGE",
          message: error.message,
        });
      throw error;
    }
  }
  async content(ownerId: string, id: string) {
    const r = await this.db.query(
      "SELECT mime_type FROM media_assets WHERE id=$1 AND owner_id=$2 AND state='confirmed'",
      [id, ownerId],
    );
    if (!r.rowCount)
      throw new NotFoundException({
        code: "MEDIA_NOT_FOUND",
        message: "Media not found",
      });
    return {
      stream: await this.storage.read(id),
      mimeType: r.rows[0].mime_type,
    };
  }
}
