import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javaHome =
  process.env.JAVA_HOME ??
  "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
const androidHome =
  process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools";
if (!existsSync(javaHome) || !existsSync(androidHome))
  throw new Error(
    "Set JAVA_HOME (JDK 21) and ANDROID_HOME (Android SDK) first. See README.md.",
  );
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome };
const run = (command, args, cwd = root) =>
  new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
await run("pnpm", ["build:contracts"]);
await run("pnpm", [
  "--filter",
  "@my-staff/mobile",
  "exec",
  "expo",
  "prebuild",
  "--platform",
  "android",
  "--no-install",
]);
await run(
  "./gradlew",
  [
    ":app:assembleRelease",
    "-PreactNativeArchitectures=arm64-v8a",
    "--no-daemon",
    "--max-workers=2",
    "--console=plain",
    "-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m",
    "-Pkotlin.compiler.execution.strategy=in-process",
  ],
  resolve(root, "apps/mobile/android"),
);
const directory = resolve(root, "artifacts");
await mkdir(directory, { recursive: true });
const target = resolve(directory, "my-collection-android.apk");
await copyFile(
  resolve(
    root,
    "apps/mobile/android/app/build/outputs/apk/release/app-release.apk",
  ),
  target,
);
const hash = createHash("sha256")
  .update(await readFile(target))
  .digest("hex");
await writeFile(target + ".sha256", `${hash}  my-collection-android.apk\n`);
console.log(
  `\nTest APK (ARM64, local debug signing): ${target}\nSHA-256: ${hash}`,
);
