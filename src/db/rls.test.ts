/**
 * Phase 1 PG RLS end-to-end test — verifies that the row-level security
 * policy actually prevents cross-tenant reads, even when application code
 * forgets a WHERE clause.
 *
 * Requires a running Postgres (docker run klaus-pg-dev / VPS) at
 * DATABASE_URL or postgres://klaus:klaus@localhost:5433/klaus.
 *
 * Test plan (decision #4 safety net validation):
 *  1. Connect as klaus_app (no BYPASSRLS).
 *  2. Insert two cron_tasks: one for user A, one for user B (using
 *     klaus_admin to bypass RLS for setup).
 *  3. Inside withUserScope(A), do `SELECT * FROM cron_tasks` (no WHERE!).
 *     RLS must filter to only A's rows — even though the SQL has no
 *     user_id condition.
 *  4. Try to UPDATE B's row from within A's scope — must affect 0 rows.
 *  5. Without any scope, a query must see 0 rows (policy fails closed).
 *
 * Run: `npm test -- src/db/rls.test.ts` (after `colima start && docker run …`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { cronTasks, users } from "./schema.js";
import { withUserScope, getDb, closeDb } from "./connection.js";

// Use the public klaus user for app-side tests (NO BYPASSRLS).
// In real deploys you'd connect as klaus_app, but the bootstrap user inherits
// the same role properties since this DB is just for tests.
const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://klaus:klaus@localhost:5433/klaus";

describe("Postgres RLS (decision #4 cross-tenant safety net)", () => {
  // Use a separate admin pool for setup / teardown — bypasses RLS.
  // For local dev that's the same `klaus` superuser; in prod it'd be klaus_admin.
  let adminPool: Pool;
  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: TEST_DB_URL });
    // bootstrap two users + one cron each
    await adminPool.query(`
      INSERT INTO users (id, email, password_hash, last_login_at, quota_reset_at)
      VALUES
        ($1, 'a@test', '', NOW(), NOW()),
        ($2, 'b@test', '', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `, [userA, userB]);
    // Set DATABASE_URL so getDb() uses the same instance.
    process.env.DATABASE_URL = TEST_DB_URL;
  });

  beforeEach(async () => {
    // Wipe + re-seed cron_tasks per test for isolation.
    await adminPool.query(`DELETE FROM cron_tasks WHERE user_id IN ($1, $2)`, [
      userA,
      userB,
    ]);
    await adminPool.query(`
      INSERT INTO cron_tasks (id, user_id, schedule, prompt, created_at, updated_at)
      VALUES
        ('a-task', $1, '0 * * * *', 'A''s task', NOW(), NOW()),
        ('b-task', $2, '0 * * * *', 'B''s task', NOW(), NOW())
    `, [userA, userB]);
  });

  afterAll(async () => {
    if (adminPool) {
      await adminPool.query(`DELETE FROM cron_tasks WHERE user_id IN ($1, $2)`, [
        userA,
        userB,
      ]);
      await adminPool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
        userA,
        userB,
      ]);
      await adminPool.end();
    }
    await closeDb();
  });

  it("withUserScope(A): SELECT without WHERE returns only A's rows", async () => {
    const rows = await withUserScope(userA, async (tx) => {
      return await tx.select().from(cronTasks);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a-task");
    expect(rows[0].userId).toBe(userA);
  });

  it("withUserScope(B): SELECT without WHERE returns only B's rows", async () => {
    const rows = await withUserScope(userB, async (tx) => {
      return await tx.select().from(cronTasks);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("b-task");
  });

  it("withUserScope(A): UPDATE on B's row affects 0 rows (RLS hides it)", async () => {
    const updated = await withUserScope(userA, async (tx) => {
      return await tx
        .update(cronTasks)
        .set({ prompt: "hacked" })
        .where(sql`${cronTasks.id} = 'b-task'`)
        .returning();
    });
    expect(updated).toHaveLength(0);
    // Verify B's task is intact via admin pool
    const after = await adminPool.query(
      `SELECT prompt FROM cron_tasks WHERE id = 'b-task'`,
    );
    expect(after.rows[0].prompt).toBe("B's task");
  });

  it("without withUserScope: query returns 0 rows (policy fails closed)", async () => {
    // Query directly via the global db with no SET LOCAL — RLS fails closed.
    const db = getDb({ url: TEST_DB_URL });
    const rows = await db.select().from(cronTasks);
    expect(rows).toHaveLength(0);
  });

  it("INSERT into A's scope: WITH CHECK rejects rows for other users", async () => {
    // App tries to insert a row for B while scoped as A — WITH CHECK denies.
    await expect(
      withUserScope(userA, async (tx) => {
        await tx.insert(cronTasks).values({
          id: "evil",
          userId: userB,
          schedule: "0 * * * *",
          prompt: "should fail",
        });
      }),
    ).rejects.toThrow();
  });
});
