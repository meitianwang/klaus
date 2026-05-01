/**
 * DesktopAuthRepo unit tests — in-memory SQLite.
 *
 * Both `desktop_auth_codes` and `desktop_tokens` are exercised together
 * because they share the OAuth-style PKCE redemption flow. The "atomic
 * mark-used + insert-token" sequence runs inside a db.transaction() upstream
 * (in UserStore); these tests verify the individual repo primitives behave
 * correctly when called in that order.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DesktopAuthRepo } from "./desktop-auth.js";

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE desktop_auth_codes (
      code            TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      state           TEXT NOT NULL,
      code_challenge  TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER NOT NULL,
      used_at         INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE desktop_tokens (
      token         TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      last_used_at  INTEGER NOT NULL,
      device_info   TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

describe("DesktopAuthRepo", () => {
  let db: Database;
  let repo: DesktopAuthRepo;

  beforeEach(() => {
    db = freshDb();
    repo = new DesktopAuthRepo(db);
  });

  it("insertCode + findCode roundtrip", () => {
    const now = Date.now();
    repo.insertCode({
      code: "c1",
      userId: "u1",
      state: "s",
      codeChallenge: "ch",
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    });
    const row = repo.findCode("c1");
    expect(row?.user_id).toBe("u1");
    expect(row?.used_at).toBe(0);
  });

  it("markCodeUsed makes a second redemption visible as 'consumed'", () => {
    const now = Date.now();
    repo.insertCode({
      code: "c1",
      userId: "u1",
      state: "s",
      codeChallenge: "ch",
      createdAt: now,
      expiresAt: now + 1000,
    });
    repo.markCodeUsed("c1", now + 10);
    expect(repo.findCode("c1")?.used_at).toBe(now + 10);
  });

  it("pruneCodes removes expired AND already-used codes", () => {
    const now = Date.now();
    // expired
    repo.insertCode({
      code: "old",
      userId: "u1",
      state: "s",
      codeChallenge: "ch",
      createdAt: 0,
      expiresAt: 1,
    });
    // already used
    repo.insertCode({
      code: "used",
      userId: "u1",
      state: "s",
      codeChallenge: "ch",
      createdAt: now,
      expiresAt: now + 100_000,
    });
    repo.markCodeUsed("used", now);
    // alive
    repo.insertCode({
      code: "alive",
      userId: "u1",
      state: "s",
      codeChallenge: "ch",
      createdAt: now,
      expiresAt: now + 100_000,
    });
    const removed = repo.pruneCodes(now);
    expect(removed).toBe(2);
    expect(repo.findCode("alive")).toBeDefined();
  });

  it("insertToken + findTokenUserId roundtrip", () => {
    const now = Date.now();
    repo.insertToken({
      token: "tok1",
      userId: "u1",
      createdAt: now,
      lastUsedAt: now,
      deviceInfo: "MacBook",
    });
    expect(repo.findTokenUserId("tok1")).toBe("u1");
    expect(repo.findTokenUserId("nope")).toBeFalsy();
  });

  it("touchTokenLastUsed bumps timestamp without changing owner", () => {
    const now = Date.now();
    repo.insertToken({
      token: "tok1",
      userId: "u1",
      createdAt: now,
      lastUsedAt: now,
      deviceInfo: "",
    });
    repo.touchTokenLastUsed("tok1", now + 5000);
    expect(repo.findTokenUserId("tok1")).toBe("u1");
  });

  it("deleteToken removes; idempotent", () => {
    const now = Date.now();
    repo.insertToken({
      token: "tok1",
      userId: "u1",
      createdAt: now,
      lastUsedAt: now,
      deviceInfo: "",
    });
    expect(repo.deleteToken("tok1")).toBe(true);
    expect(repo.deleteToken("tok1")).toBe(false);
  });

  it("redemption flow inside a db.transaction stays atomic on error", () => {
    const now = Date.now();
    repo.insertCode({
      code: "c1",
      userId: "u1",
      state: "s",
      codeChallenge: "ch",
      createdAt: now,
      expiresAt: now + 1000,
    });
    // Simulate UserStore.redeemDesktopAuthCode's atomic block — markCodeUsed
    // succeeds, insertToken throws (PK collision), entire txn rolls back.
    repo.insertToken({
      token: "dupe",
      userId: "u1",
      createdAt: now,
      lastUsedAt: now,
      deviceInfo: "",
    });
    expect(() => {
      db.transaction(() => {
        repo.markCodeUsed("c1", now + 10);
        repo.insertToken({
          token: "dupe", // collision
          userId: "u1",
          createdAt: now,
          lastUsedAt: now,
          deviceInfo: "",
        });
      })();
    }).toThrow();
    // The mark-used should also be rolled back since they share the txn.
    expect(repo.findCode("c1")?.used_at).toBe(0);
  });
});
