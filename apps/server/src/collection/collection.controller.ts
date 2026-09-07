import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { body } from "../common/http";
import { CollectionService } from "./collection.service";
import {
  createItemSchema,
  updateItemSchema,
  uuidSchema,
} from "@my-staff/contracts";
@Controller("items")
@UseGuards(AuthGuard)
export class CollectionController {
  constructor(
    @Inject(CollectionService) private readonly items: CollectionService,
  ) {}
  @Get() list(
    @Req() req: any,
    @Query("includeDeleted") includeDeleted?: string,
  ) {
    return this.items.list(req.user.id, includeDeleted === "true");
  }
  @Put(":id") create(
    @Req() req: any,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.items.create(
      req.user.id,
      body(uuidSchema, id),
      body(createItemSchema, input),
    );
  }
  @Patch(":id") update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.items.patch(
      req.user.id,
      body(uuidSchema, id),
      body(updateItemSchema, input),
    );
  }
}
