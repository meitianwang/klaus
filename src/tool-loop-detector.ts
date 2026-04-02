/**
 * Tool call loop detector — detects repetitive tool call patterns and blocks them.
 *
 * Two patterns detected:
 * - genericRepeat: identical tool+args called consecutively
 * - pingPong: two tools alternating (A→B→A→B)
 */

import type { BeforeToolCallContext, BeforeToolCallResult } from "./klaus-agent-compat.js";

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
}

const DEFAULT_MAX_REPEAT = 3;
const DEFAULT_WINDOW_SIZE = 10;
const MAX_HASH_INPUT = 4096;

export class ToolLoopDetector {
  private readonly history: ToolCallRecord[] = [];
  private readonly maxRepeat: number;
  private readonly windowSize: number;

  constructor(opts?: { maxRepeat?: number; windowSize?: number }) {
    this.maxRepeat = opts?.maxRepeat ?? DEFAULT_MAX_REPEAT;
    this.windowSize = opts?.windowSize ?? DEFAULT_WINDOW_SIZE;
  }

  /**
   * Check if the upcoming tool call looks like a loop. Returns a block result
   * if detected, otherwise undefined (allow).
   * Note: incoming record is compared against history, then appended after detection.
   */
  check(ctx: BeforeToolCallContext): BeforeToolCallResult | undefined {
    const argsHash = hashArgs(ctx.args);
    const record: ToolCallRecord = { toolName: ctx.toolName, argsHash };

    const result =
      this.detectGenericRepeat(record) ??
      this.detectPingPong(record);

    this.history.push(record);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return result;
  }

  /** Same tool + same args called N times in a row. */
  private detectGenericRepeat(incoming: ToolCallRecord): BeforeToolCallResult | undefined {
    let streak = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const prev = this.history[i];
      if (prev.toolName === incoming.toolName && prev.argsHash === incoming.argsHash) {
        streak++;
      } else {
        break;
      }
    }
    if (streak >= this.maxRepeat) {
      return {
        block: true,
        reason: `Loop detected: "${incoming.toolName}" called ${streak + 1} times consecutively with identical arguments. Try a different approach.`,
      };
    }
  }

  /** A→B→A→B alternating pattern. */
  private detectPingPong(incoming: ToolCallRecord): BeforeToolCallResult | undefined {
    const h = this.history;
    const len = h.length;
    if (len < 3) return;

    const a = h[len - 1];
    const b = h[len - 2];
    const c = h[len - 3];

    if (
      incoming.toolName === b.toolName &&
      incoming.argsHash === b.argsHash &&
      a.toolName === c.toolName &&
      a.argsHash === c.argsHash &&
      incoming.toolName !== a.toolName
    ) {
      return {
        block: true,
        reason: `Loop detected: "${a.toolName}" and "${incoming.toolName}" alternating repeatedly. Try a different approach.`,
      };
    }
  }
}

/** Simple string hash (djb2) to avoid storing full JSON in memory. */
function hashArgs(args: unknown): string {
  let raw: string;
  try {
    raw = JSON.stringify(args ?? null);
  } catch {
    raw = String(args);
  }
  if (raw.length > MAX_HASH_INPUT) {
    raw = raw.slice(0, MAX_HASH_INPUT);
  }
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
