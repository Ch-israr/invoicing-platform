import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 60_000,
    // Vitest 4 removed poolOptions (and tinypool): singleThread is now
    // maxWorkers: 1 + isolate: false. Integration tests share one test
    // database; run serially to avoid interleaving writes.
    maxWorkers: 1,
    isolate: false,
  },
});
