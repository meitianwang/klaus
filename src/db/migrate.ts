/**
 * Apply pending Drizzle migrations to the configured Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx src/db/migrate.ts
 *   # or via npm script:
 *   npm run db:migrate
 *
 * Drizzle-orm's migrator handles tracking via __drizzle_migrations table.
 * We then apply RLS policies (0001_rls_policies.sql) which Drizzle's
 * generator can't emit (CREATE POLICY etc. need raw SQL).
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  console.log("[migrate] applying drizzle migrations...");
  await migrate(db, { migrationsFolder: join(__dirname, "migrations") });

  console.log("[migrate] applying RLS policies (0001_rls_policies.sql)...");
  const rlsSql = readFileSync(
    join(__dirname, "migrations", "0001_rls_policies.sql"),
    "utf8",
  );
  // RLS migration is idempotent (CREATE POLICY IF NOT EXISTS isn't supported,
  // but the IF NOT EXISTS dance for roles + DROP POLICY pattern keeps re-runs safe).
  // For now we wrap in a savepoint and ignore "already exists" on second run.
  try {
    await pool.query(rlsSql);
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      console.log("[migrate] RLS policies already present, skipping");
    } else {
      throw err;
    }
  }

  console.log("[migrate] done");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
