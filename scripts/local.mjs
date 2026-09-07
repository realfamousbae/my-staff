import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://collection:local-development-only@127.0.0.1:55432/collection",
  LOCAL_STORAGE_DIR:
    process.env.LOCAL_STORAGE_DIR ?? resolve(root, ".local/storage"),
  AI_ENABLED: process.env.AI_ENABLED ?? "false",
  TEST_DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://collection:local-development-only@127.0.0.1:55432/collection",
};
await mkdir(env.LOCAL_STORAGE_DIR, { recursive: true });
const children = new Set();
const run = (program, args) =>
  new Promise((accept, reject) => {
    const child = spawn(program, args, { cwd: root, env, stdio: "inherit" });
    children.add(child);
    child.on("error", reject);
    child.on("exit", (code) => {
      children.delete(child);
      code === 0
        ? accept()
        : reject(new Error(`${program} exited with ${code}`));
    });
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
const task = process.argv[2] ?? "dev";
try {
  if (task === "setup") {
    await run("docker", ["compose", "up", "-d", "--wait"]);
    await run("pnpm", ["build:contracts"]);
    await run("pnpm", ["--filter", "@my-staff/server", "db:migrate"]);
    console.log(
      "Локальная база готова. Запустите pnpm dev:backend и pnpm dev:mobile.",
    );
  } else if (task === "test") {
    await run("pnpm", ["build:contracts"]);
    await run("pnpm", ["exec", "vitest", "run"]);
  } else if (task === "migrate")
    await run("pnpm", ["--filter", "@my-staff/server", "db:migrate"]);
  else if (task === "api")
    await run("pnpm", ["--filter", "@my-staff/server", "dev"]);
  else if (task === "worker")
    await run("pnpm", ["--filter", "@my-staff/server", "worker"]);
  else if (task === "dev") {
    await run("pnpm", ["build:contracts"]);
    await Promise.all([
      run("pnpm", ["--filter", "@my-staff/server", "dev"]),
      run("pnpm", ["--filter", "@my-staff/server", "worker"]),
    ]);
  } else throw new Error("Unknown task: " + task);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = 1;
}
