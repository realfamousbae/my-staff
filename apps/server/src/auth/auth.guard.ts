import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const value = req.headers.authorization;
    req.user = await this.auth.userFromToken(
      typeof value === "string" && value.startsWith("Bearer ")
        ? value.slice(7)
        : undefined,
    );
    return true;
  }
}
