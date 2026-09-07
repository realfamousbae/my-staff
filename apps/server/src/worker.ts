import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { AppModule } from "./app.module";
import {
  ProcessingService,
  type ProcessingPayload,
} from "./processing/processing.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const processing = app.get(ProcessingService);
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
  boss.on("error", (error) => console.error("Queue error:", error.message));
  await boss.start();
  await boss.createQueue("process-item");
  await boss.work<{ outboxId: string; payload: ProcessingPayload }>(
    "process-item",
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processing.complete(job.data.outboxId, job.data.payload);
        } catch (error) {
          await processing.fail(job.data.outboxId, error);
          throw error;
        }
      }
    },
  );
  let dispatching = false;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      await processing.dispatch(boss);
    } catch (error) {
      console.error(
        "Dispatch failed:",
        error instanceof Error ? error.message : "unknown",
      );
    } finally {
      dispatching = false;
    }
  };
  await dispatch();
  const timer = setInterval(() => void dispatch(), 2000);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await boss.stop();
    await app.close();
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
