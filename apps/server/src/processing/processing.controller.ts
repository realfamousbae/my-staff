import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { operationSchema, uuidSchema } from "@my-staff/contracts";
import { AuthGuard } from "../auth/auth.guard";
import { body } from "../common/http";
import { ProcessingService } from "./processing.service";

@Controller("items")
@UseGuards(AuthGuard)
export class ProcessingController {
  constructor(
    @Inject(ProcessingService) private readonly processing: ProcessingService,
  ) {}

  @Post(":id/process")
  process(
    @Req() req: { user: { id: string } },
    @Param("id") itemId: string,
    @Body() input: unknown,
  ) {
    return this.processing.request(
      req.user.id,
      body(uuidSchema, itemId),
      body(operationSchema, input).operationId,
    );
  }
}
