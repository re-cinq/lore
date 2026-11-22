// Tells whoever holds something opened with a session row that the session ended on sign-out, removal or revocation (FR-279); upgrade and rollback cleanup runs with lore-api scaled to zero (FR-332, FR-063).

type SessionEndedListener = (sessionId: string) => void;

const listeners = new Set<SessionEndedListener>();

/** Subscribes to ended sessions; the returned function unsubscribes. */
export function onSessionEnded(listener: SessionEndedListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Announces that the session row `sessionId` ended. */
export function announceSessionEnded(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId);
  }
}
