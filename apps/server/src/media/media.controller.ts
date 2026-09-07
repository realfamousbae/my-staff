import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { body } from "../common/http";
import { MediaService } from "./media.service";
import {
  createMediaSchema,
  operationSchema,
  uuidSchema,
} from "@my-staff/contracts";
@Controller()
@UseGuards(AuthGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post("items/:itemId/media") create(
    @Req() req: any,
    @Param("itemId") itemId: string,
    @Body() input: unknown,
  ) {
    return this.media.create(
      req.user.id,
      body(uuidSchema, itemId),
      body(createMediaSchema, input),
    );
  }
  @Post("media/:id/upload-ticket") ticket(
    @Req() req: any,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.media.ticket(
      req.user.id,
      body(uuidSchema, id),
      body(operationSchema, input).operationId,
    );
  }
  @Put("uploads/:id") async upload(
    @Req() req: any,
    @Param("id") mediaId: string,
  ) {
    await this.media.upload(req.user.id, body(uuidSchema, mediaId), req);
    return { ok: true };
  }
  @Post("media/:id/confirm") confirm(
    @Req() req: any,
    @Param("id") mediaId: string,
    @Body() input: unknown,
  ) {
    return this.media.confirm(
      req.user.id,
      body(uuidSchema, mediaId),
      body(operationSchema, input).operationId,
    );
  }
  @Get("media/:id/content") async content(
    @Req() req: any,
    @Param("id") mediaId: string,
    @Res() res: Response,
  ) {
    const out = await this.media.content(
      req.user.id,
      body(uuidSchema, mediaId),
    );
    res.type(out.mimeType);
    out.stream.pipe(res);
  }
}
