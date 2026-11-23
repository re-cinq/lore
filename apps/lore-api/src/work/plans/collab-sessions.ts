/** Close code for a connection whose session ended; Hocuspocus's own refusal code. */
const SESSION_ENDED_CODE = 4401;

/** One open collaboration connection, as far as session closing needs it. */
export interface HeldConnection {
  context?: { user?: { sessionId?: string | null } };
  webSocket: { close(code?: number, reason?: string): void };
}

/** The slice of Hocuspocus that holds open collaboration connections. */
export interface CollabConnections {
  documents: Map<string, { getConnections(): HeldConnection[] }>;
}

/** FR-304: closes every open plan collaboration connection authenticated with a token minted for the session. */
export function closeCollabSession(
  collab: CollabConnections,
  sessionId: string,
): void {
  [...collab.documents.values()]
    .flatMap((document) => document.getConnections())
    .filter((connection) => sessionOf(connection) === sessionId)
    .forEach((connection) =>
      connection.webSocket.close(SESSION_ENDED_CODE, "session ended"),
    );
}

export function sessionOf(
  connection: HeldConnection,
): string | null | undefined {
  const user = connection.context?.user;

  return user?.sessionId;
}
