import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { body } from "../common/http";
import { CatalogService } from "./catalog.service";
import {
  changeEditionSchema,
  createEditionSchema,
  mergeEditionSchema,
  uuidSchema,
} from "@my-staff/contracts";
@Controller("catalog/editions")
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Get() list(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("category") category?: string,
  ) {
    return this.catalog.list(req.user, q, category);
  }
  @Post() propose(@Req() req: any, @Body() input: unknown) {
    return this.catalog.propose(req.user, body(createEditionSchema, input));
  }
  @Post(":id/confirm") confirm(
    @Req() req: any,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.catalog.confirm(
      req.user,
      body(uuidSchema, id),
      body(changeEditionSchema, input),
    );
  }
  @Post(":id/merge") merge(
    @Req() req: any,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.catalog.merge(
      req.user,
      body(uuidSchema, id),
      body(mergeEditionSchema, input),
    );
  }
}
