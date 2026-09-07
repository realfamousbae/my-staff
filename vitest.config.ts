import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/android/**", "**/ios/**"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: { NODE_ENV: "test" },
  },
});
