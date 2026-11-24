import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// Applies committed migrations to the TEST database before the suite
// runs. Loads .env when it exists (local dev), but CI sets the
// variables as job env and has no .env file (it is gitignored), so
// never require one — TEST_DATABASE_URL comes from the environment
// either way.
export async function setup() {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL must be set (in .env or the environment) for tests",
    );
  }
  execSync("node_modules/.bin/prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}

export async function teardown() {}
