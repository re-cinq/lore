import type { WebSocket } from "ws";

const OPEN = 1;

/** Close code for a socket whose session ended. */
const SESSION_ENDED_CODE = 4401;

interface LookupEntry {
  ws: WebSocket;
  row: Promise<string | undefined>;
}

function entryOf(entries: Set<LookupEntry>, ws: WebSocket): LookupEntry {
  return [...entries].find((entry) => entry.ws === ws) as LookupEntry;
}

/** The open sockets by the session row that opened each (FR-300). */
export class SessionSockets {
  private readonly held = new Map<string, Set<WebSocket>>();
  private readonly looking = new Set<LookupEntry>();

  add(sessionId: string, ws: WebSocket): void {
    const sockets = this.held.get(sessionId) ?? new Set<WebSocket>();

    sockets.add(ws);
    this.held.set(sessionId, sockets);
    ws.once("close", () => {
      sockets.delete(ws);

      if (sockets.size === 0) {
        this.held.delete(sessionId);
      }
    });
  }

  /** A socket whose session row is still being looked up: ending that row closes it once known. */
  lookup(ws: WebSocket, row: Promise<string | undefined>): void {
    this.looking.add({ ws, row });
    ws.once("close", () => this.looking.delete(entryOf(this.looking, ws)));
  }

  close(sessionId: string): void {
    for (const entry of this.looking) {
      void entry.row.then((id) => {
        if (id === sessionId && entry.ws.readyState === OPEN) {
          entry.ws.close(SESSION_ENDED_CODE, "session ended");
        }
      });
    }

    for (const ws of this.held.get(sessionId) ?? []) {
      ws.close(SESSION_ENDED_CODE, "session ended");
    }
  }
}
