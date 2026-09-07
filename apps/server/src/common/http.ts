import { BadRequestException } from "@nestjs/common";
import { ZodSchema } from "zod";

export function body<T>(schema: ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException({
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((x) => x.message).join("; "),
    });
  return parsed.data;
}
export function iso(value: Date | string | null | undefined) {
  return value == null ? null : new Date(value).toISOString();
}
