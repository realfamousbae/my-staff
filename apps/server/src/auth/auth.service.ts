import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { DbService } from "../db/db.service";
const scrypt = promisify(scryptCallback);
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
};
const verifyPassword = async (password: string, stored: string) => {
  const [, salt, expected] = stored.split("$");
  const got = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(got, Buffer.from(expected, "hex"));
};

@Injectable()
export class AuthService {
  constructor(@Inject(DbService) private readonly db: DbService) {}
  async register(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const id = randomUUID();
    try {
      await this.db.query(
        "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
        [id, email, await hashPassword(password)],
      );
    } catch (error: any) {
      if (error.code === "23505")
        throw new ConflictException({
          code: "EMAIL_TAKEN",
          message: "Email already registered",
        });
      throw error;
    }
    return this.issue(id, email);
  }
  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const result = await this.db.query<{
      id: string;
      email: string;
      password_hash: string;
    }>("SELECT id,email,password_hash FROM users WHERE email=$1", [email]);
    if (
      !result.rowCount ||
      !(await verifyPassword(password, result.rows[0].password_hash))
    )
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    return this.issue(result.rows[0].id, result.rows[0].email);
  }
  private async issue(userId: string, email: string) {
    const token = randomBytes(32).toString("base64url");
    await this.db.query(
      "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+ interval '90 days')",
      [randomUUID(), userId, tokenHash(token)],
    );
    return { token, user: { id: userId, email } };
  }
  async userFromToken(token?: string) {
    if (!token)
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Bearer token required",
      });
    const r = await this.db.query<{ id: string; email: string; role: string }>(
      "SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()",
      [tokenHash(token)],
    );
    if (!r.rowCount)
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Session is invalid or expired",
      });
    return r.rows[0];
  }
}
