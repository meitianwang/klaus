/**
 * UsersRepo unit tests — in-memory SQLite.
 *
 * Covers the `users` table SQL surface that other code paths (UserStore +
 * Phase 1 PG migration) rely on. Schema mirrors the production INIT_SQL
 * + the three migration ALTERs (failed_attempts / locked_until / avatar_url).
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { UsersRepo } from "./users.js";

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL DEFAULT '',
      display_name    TEXT NOT NULL DEFAULT '',
      role            TEXT NOT NULL DEFAULT 'user',
      google_id       TEXT UNIQUE,
      invite_code     TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL,
      last_login_at   INTEGER NOT NULL,
      is_active       INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    INTEGER NOT NULL DEFAULT 0,
      avatar_url      TEXT
    );
  `);
  return db;
}

function makeUser(overrides: Partial<Parameters<UsersRepo["insert"]>[0]> = {}) {
  const now = Date.now();
  return {
    id: "u1",
    email: "alice@example.com",
    passwordHash: "h",
    displayName: "Alice",
    role: "user",
    googleId: null,
    inviteCode: "",
    createdAt: now,
    lastLoginAt: now,
    isActive: 1,
    ...overrides,
  };
}

describe("UsersRepo", () => {
  let db: Database;
  let repo: UsersRepo;

  beforeEach(() => {
    db = freshDb();
    repo = new UsersRepo(db);
  });

  it("count() is 0 on a fresh table", () => {
    expect(repo.count()).toBe(0);
  });

  it("insert + findById + findByEmail roundtrip", () => {
    repo.insert(makeUser());
    expect(repo.count()).toBe(1);
    const byId = repo.findById("u1");
    expect(byId?.email).toBe("alice@example.com");
    const byEmail = repo.findByEmail("alice@example.com");
    expect(byEmail?.id).toBe("u1");
  });

  it("findByEmail does NOT normalize — caller responsibility", () => {
    repo.insert(makeUser());
    // mixed-case lookup must miss; UserStore does the .toLowerCase().trim() upstream
    expect(repo.findByEmail("ALICE@example.com")).toBeFalsy();
  });

  it("findByGoogleId returns the linked user", () => {
    repo.insert(makeUser({ id: "u2", email: "b@x", googleId: "g42" }));
    expect(repo.findByGoogleId("g42")?.id).toBe("u2");
    expect(repo.findByGoogleId("nope")).toBeFalsy();
  });

  it("list() orders by created_at DESC", () => {
    repo.insert(makeUser({ id: "u1", email: "a@x", createdAt: 100, lastLoginAt: 100 }));
    repo.insert(makeUser({ id: "u2", email: "b@x", createdAt: 200, lastLoginAt: 200 }));
    const list = repo.list();
    expect(list.map((u) => u.id)).toEqual(["u2", "u1"]);
  });

  it("setActive flips and reports rows-affected truthfully", () => {
    repo.insert(makeUser());
    expect(repo.setActive("u1", false)).toBe(true);
    expect(repo.findById("u1")?.is_active).toBe(0);
    expect(repo.setActive("nonexistent", false)).toBe(false);
  });

  it("setRole / setDisplayName / setAvatarUrl all go through", () => {
    repo.insert(makeUser());
    expect(repo.setRole("u1", "admin")).toBe(true);
    expect(repo.setDisplayName("u1", "Alice 2")).toBe(true);
    expect(repo.setAvatarUrl("u1", "https://x/a.png")).toBe(true);
    const row = repo.findById("u1")!;
    expect(row.role).toBe("admin");
    expect(row.display_name).toBe("Alice 2");
    expect(row.avatar_url).toBe("https://x/a.png");
  });

  it("brute-force counters: incr → reset cycle", () => {
    repo.insert(makeUser());
    repo.incrFailedAttempts("u1");
    repo.incrFailedAttempts("u1");
    expect(repo.findById("u1")?.failed_attempts).toBe(2);
    repo.lockUser("u1", 9_999_999);
    expect(repo.findById("u1")?.locked_until).toBe(9_999_999);
    repo.resetFailedAttempts("u1");
    const row = repo.findById("u1")!;
    expect(row.failed_attempts).toBe(0);
    expect(row.locked_until).toBe(0);
  });

  it("linkGoogle attaches a google_id post-hoc", () => {
    repo.insert(makeUser());
    repo.linkGoogle("u1", "g99");
    expect(repo.findById("u1")?.google_id).toBe("g99");
  });

  it("updateLastLogin moves the timestamp", () => {
    repo.insert(makeUser({ lastLoginAt: 1 }));
    repo.updateLastLogin("u1", 12345);
    expect(repo.findById("u1")?.last_login_at).toBe(12345);
  });
});
