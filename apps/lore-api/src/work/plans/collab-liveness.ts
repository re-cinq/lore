import { sessionOf, type HeldConnection } from "./collab-sessions.js";

/** How long a session check holds before the next frame asks again (FR-280). */
const FRESH_MS = 5 * 60_000;

/** Close code for a connection whose session ended. */
const SESSION_ENDED_CODE = 4401;

interface Payload {
  connection: HeldConnection;
}

/** FR-305: a Hocuspocus extension that asks again whether a connection's session is open at the first frame after five minutes, so a replica that missed the notification still closes it. */
export function collabLivenessExtension(
  sessionLive: (sessionId: string) => Promise<boolean>,
) {
  const checkedAt = new WeakMap<object, number>();

  return {
    connected: async ({ connection }: Payload): Promise<void> => {
      checkedAt.set(connection, Date.now());
    },
    beforeHandleMessage: ({ connection }: Payload): Promise<void> =>
      checkSession(connection, checkedAt, sessionLive),
  };
}

async function checkSession(
  connection: HeldConnection,
  checkedAt: WeakMap<object, number>,
  sessionLive: (sessionId: string) => Promise<boolean>,
): Promise<void> {
  const sessionId = sessionOf(connection);

  if (isFresh(sessionId, checkedAt.get(connection) ?? Date.now())) {
    return;
  }

  if (sessionId && (await sessionLive(sessionId))) {
    checkedAt.set(connection, Date.now());

    return;
  }
  connection.webSocket.close(SESSION_ENDED_CODE, "session ended");
  throw new Error("session ended");
}

/** Whether the connection's check is still fresh, or it has no session to check. */
function isFresh(sessionId: string | null | undefined, last: number): boolean {
  return !sessionId || Date.now() - last < FRESH_MS;
}
