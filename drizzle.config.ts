/**
 * drizzle-kit configuration.
 *
 * Local dev: docker run klaus-pg-dev maps :5433 → :5432 inside container.
 * Override via DATABASE_URL env var for VPS / CI / other environments.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://klaus:klaus@localhost:5433/klaus",
  },
  // Verbose diff for review during Phase 1 bring-up.
  verbose: true,
  strict: true,
});
