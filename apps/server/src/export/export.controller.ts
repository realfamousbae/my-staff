import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { ExportService } from "./export.service";
@Controller()
@UseGuards(AuthGuard)
export class ExportController {
  constructor(@Inject(ExportService) private readonly archive: ExportService) {}
  @Get("export") async export(@Req() req: any, @Res() res: Response) {
    res
      .type("application/zip")
      .attachment("collection.zip")
      .send(await this.archive.create(req.user.id));
  }
  @Post("import") async import(@Req() req: any, @Body() body: any) {
    const archive = Buffer.isBuffer(body)
      ? body
      : Buffer.from(body?.archiveBase64 ?? "", "base64");
    return this.archive.restore(req.user.id, archive);
  }
}
