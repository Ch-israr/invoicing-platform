// Runs in every Vitest worker before test files are imported.
// Loads .env, then points the app's Prisma client at the TEST database
// so integration tests never touch the dev database.
process.loadEnvFile(".env");

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be set in .env for tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
