import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { canonicalJson } from "@my-staff/contracts";

export const payloadHash = (payload: unknown) =>
  createHash("sha256").update(canonicalJson(payload)).digest("hex");

export async function replay<T>(
  client: PoolClient,
  ownerId: string,
  operationId: string,
  kind: string,
  payload: unknown,
): Promise<T | undefined> {
  // A per-account transaction lock prevents two retries from both observing a miss.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    ownerId,
  ]);
  const hash = payloadHash(payload);
  const found = await client.query<{ response: T; payload_hash: string }>(
    "SELECT response,payload_hash FROM operation_keys WHERE owner_id=$1 AND operation_id=$2 AND kind=$3",
    [ownerId, operationId, kind],
  );
  if (!found.rowCount) return undefined;
  if (found.rows[0].payload_hash !== hash) {
    throw new ConflictException({
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
      message: "operationId was already used with another request",
    });
  }
  return found.rows[0].response;
}

export async function remember(
  client: PoolClient,
  ownerId: string,
  operationId: string,
  kind: string,
  payload: unknown,
  response: unknown,
) {
  await client.query(
    "INSERT INTO operation_keys(owner_id,operation_id,kind,payload_hash,response) VALUES($1,$2,$3,$4,$5)",
    [ownerId, operationId, kind, payloadHash(payload), response],
  );
}
