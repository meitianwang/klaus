/**
 * Session transcript event bus — aligned with OpenClaw's transcript-events.ts.
 * Observer pattern: memory manager subscribes, message-store emits.
 */

type SessionTranscriptUpdate = {
  sessionFile: string;
  sessionKey?: string;
};

type Listener = (update: SessionTranscriptUpdate) => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to session transcript updates. Returns unsubscribe function.
 */
export function onSessionTranscriptUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Emit a transcript update event. Called by message-store after appending.
 */
export function emitSessionTranscriptUpdate(update: string | SessionTranscriptUpdate): void {
  const normalized: SessionTranscriptUpdate =
    typeof update === "string" ? { sessionFile: update } : update;
  if (!normalized.sessionFile?.trim()) return;
  for (const listener of listeners) {
    try { listener(normalized); } catch {}
  }
}
