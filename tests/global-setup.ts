import { execSync } from "node:child_process";

// Applies committed migrations to the TEST database before the suite
// runs, so `pnpm test` works on a fresh checkout (given .env exists).
export async function setup() {
  process.loadEnvFile(".env");
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL must be set in .env for tests");
  }
  execSync("node_modules/.bin/prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}

export async function teardown() {}
