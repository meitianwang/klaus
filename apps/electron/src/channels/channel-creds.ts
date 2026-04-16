/**
 * Simple credential obfuscation for channel secrets stored in SettingsStore.
 *
 * NOT cryptographic security — the key is derived from a fixed machine identifier.
 * Purpose: prevent casual exposure (e.g. someone browsing the SQLite DB).
 * For real security, use OS keychain or external secret management.
 */

import crypto from "node:crypto";
import { homedir } from "node:os";

// Derive a machine-specific key from homedir + hostname (deterministic, no extra config)
const KEY_SEED = `klaus-cred-${homedir()}-${process.env.HOSTNAME ?? "local"}`;
const KEY = crypto.createHash("sha256").update(KEY_SEED).digest().subarray(0, 32);
const IV_LEN = 16;

export function encryptCred(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptCred(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(":")) return ciphertext; // passthrough for legacy plaintext
  try {
    const [ivHex, dataHex] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, iv);
    return decipher.update(data) + decipher.final("utf-8");
  } catch {
    return ciphertext; // fallback: treat as plaintext (migration from unencrypted)
  }
}
