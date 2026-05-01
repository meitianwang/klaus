/**
 * CronRepo unit tests — in-memory SQLite.
 *
 * Schema mirrors production INIT_SQL + the user_id migration.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { CronRepo } from "./cron.js";

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cron_tasks (
      id                TEXT PRIMARY KEY,
      user_id           TEXT,
      name              TEXT,
      description       TEXT,
      schedule          TEXT NOT NULL,
      prompt            TEXT NOT NULL,
      enabled           INTEGER NOT NULL DEFAULT 1,
      thinking          TEXT,
      light_context     INTEGER DEFAULT 0,
      timeout_seconds   INTEGER,
      delete_after_run  INTEGER DEFAULT 0,
      deliver           TEXT,
      webhook_url       TEXT,
      webhook_token     TEXT,
      failure_alert     TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
  `);
  return db;
}

function makeTask(overrides: Partial<Parameters<CronRepo["upsert"]>[0]> = {}) {
  const now = Date.now();
  return {
    id: "t1",
    userId: "u1",
    name: "task",
    description: null,
    schedule: "0 * * * *",
    prompt: "do something",
    enabled: 1,
    thinking: null,
    lightContext: 0,
    timeoutSeconds: null,
    deleteAfterRun: 0,
    deliver: null,
    webhookUrl: null,
    webhookToken: null,
    failureAlert: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("CronRepo", () => {
  let db: Database;
  let repo: CronRepo;

  beforeEach(() => {
    db = freshDb();
    repo = new CronRepo(db);
  });

  it("upsert + findById roundtrip", () => {
    repo.upsert(makeTask());
    const row = repo.findById("t1");
    expect(row?.schedule).toBe("0 * * * *");
    expect(row?.user_id).toBe("u1");
  });

  it("upsert is truly upsert (same id replaces fields)", () => {
    repo.upsert(makeTask({ name: "v1" }));
    repo.upsert(makeTask({ name: "v2", schedule: "*/5 * * * *" }));
    const row = repo.findById("t1");
    expect(row?.name).toBe("v2");
    expect(row?.schedule).toBe("*/5 * * * *");
  });

  it("listByUser scopes results to one user", () => {
    repo.upsert(makeTask({ id: "t1", userId: "u1", createdAt: 100 }));
    repo.upsert(makeTask({ id: "t2", userId: "u2", createdAt: 200 }));
    repo.upsert(makeTask({ id: "t3", userId: "u1", createdAt: 300 }));
    const u1 = repo.listByUser("u1");
    expect(u1.map((t) => t.id).sort()).toEqual(["t1", "t3"]);
  });

  it("list returns all rows sorted by created_at ASC", () => {
    repo.upsert(makeTask({ id: "t1", createdAt: 200 }));
    repo.upsert(makeTask({ id: "t2", createdAt: 100 }));
    expect(repo.list().map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("delete returns false on miss, true on hit", () => {
    expect(repo.delete("nope")).toBe(false);
    repo.upsert(makeTask());
    expect(repo.delete("t1")).toBe(true);
    expect(repo.findById("t1")).toBeFalsy();
  });

  it("deleteUserTask only deletes when both id + user_id match", () => {
    repo.upsert(makeTask({ id: "t1", userId: "u1" }));
    // wrong user_id = no-op
    expect(repo.deleteUserTask("u2", "t1")).toBe(false);
    expect(repo.findById("t1")).toBeDefined();
    // matching user_id = success
    expect(repo.deleteUserTask("u1", "t1")).toBe(true);
    expect(repo.findById("t1")).toBeFalsy();
  });

  it("supports legacy NULL user_id rows (pre-migration data)", () => {
    repo.upsert(makeTask({ userId: null }));
    expect(repo.findById("t1")?.user_id).toBeNull();
    // listByUser filters out NULL user_id (correct for SaaS)
    expect(repo.listByUser("u1")).toHaveLength(0);
  });
});
