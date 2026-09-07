import { existsSync } from "node:fs";
import { readdir, stat, rm, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commands =
  process.platform === "win32"
    ? ""
    : execFileSync("ps", ["-ax", "-o", "command="], { encoding: "utf8" });
if (
  commands
    .split("\n")
    .some((line) =>
      line.includes(
        `${root}/apps/mobile/android/gradle/wrapper/gradle-wrapper.jar`,
      ),
    )
) {
  throw new Error(
    "Android-сборка ещё работает. Очистку нужно запускать после её завершения.",
  );
}
const paths = [
  "apps/mobile/android/.gradle",
  "apps/mobile/android/build",
  "apps/mobile/android/app/.cxx",
  "apps/mobile/android/app/build",
  "apps/mobile/dist",
  "apps/mobile/.expo",
  "apps/mobile/node_modules/.cache",
  "node_modules/.cache",
];
// Expo native modules keep their generated Android outputs beside package
// sources. Remove only Gradle output folders, leaving dependencies installed.
const pnpmDirectory = resolve(root, "node_modules/.pnpm");
if (existsSync(pnpmDirectory)) {
  const generated = new Set();
  for (const entry of await readdir(pnpmDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("expo")) continue;
    const modules = join(pnpmDirectory, entry.name, "node_modules");
    if (!existsSync(modules)) continue;
    for (const module of await readdir(modules, { withFileTypes: true })) {
      if (!module.name.startsWith("expo")) continue;
      for (const folder of ["build", ".cxx", ".gradle"]) {
        const candidate = join(modules, module.name, "android", folder);
        if (!existsSync(candidate)) continue;
        const actual = await realpath(candidate);
        if (actual.startsWith(pnpmDirectory + "/"))
          generated.add(relative(root, actual));
      }
    }
  }
  paths.push(...generated);
}
if (!existsSync(resolve(root, "artifacts/my-collection-android.apk"))) {
  throw new Error(
    "Сначала сохраните установочный APK в artifacts, затем удаляйте результаты сборки.",
  );
}
async function bytes(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) total += await bytes(join(path, entry.name));
  }
  return total;
}
let freed = 0;
for (const path of paths) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) continue;
  const size = await bytes(absolute);
  if (!process.argv.includes("--dry-run"))
    await rm(absolute, { recursive: true, force: true });
  freed += size;
  console.log(
    `${process.argv.includes("--dry-run") ? "Можно удалить" : "Удалено"}: ${path} (${(size / 1024 / 1024).toFixed(1)} МБ)`,
  );
}
console.log(
  `${process.argv.includes("--dry-run") ? "Можно освободить" : "Освобождено"}: ${(freed / 1024 / 1024).toFixed(1)} МБ. APK, исходники, зависимости и данные сохранены.`,
);
