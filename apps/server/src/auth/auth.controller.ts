import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { body } from "../common/http";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { UseGuards } from "@nestjs/common";
const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(256),
});
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post("register") register(@Body() input: unknown) {
    const x = body(credentials, input);
    return this.auth.register(x.email, x.password);
  }
  @Post("login") login(@Body() input: unknown) {
    const x = body(credentials, input);
    return this.auth.login(x.email, x.password);
  }
  @Get("me") @UseGuards(AuthGuard) me(@Req() req: any) {
    return {
      user: { id: req.user.id, email: req.user.email, role: req.user.role },
    };
  }
}
