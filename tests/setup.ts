// Runs in every Vitest worker before test files are imported.
// Loads .env when it exists (local dev), then points the app's Prisma
// client at the TEST database so integration tests never touch the dev
// database. CI sets the variables as job env and has no .env file
// (it is gitignored), so never require one.
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must be set (in .env or the environment) for tests",
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
