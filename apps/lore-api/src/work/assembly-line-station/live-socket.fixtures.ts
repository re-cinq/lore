import type { LiveSocketDeps, LiveSocketLimits } from "./live-socket.js";
import { WebSocket } from "ws";
import type { LiveServerMessage } from "./protocol.js";

type Waiter = (message: LiveServerMessage) => void;

export function queuedClient(
  port: number,
  path = "/api/ws",
  headers: Record<string, string> = {},
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });

  return {
    ws,
    open: () =>
      new Promise<void>((resolve) => ws.once("open", () => resolve())),
    send: (message: object) => ws.send(JSON.stringify(message)),
    next: messageQueue(ws),
    closed: () => new Promise<number>((resolve) => ws.once("close", resolve)),
  };
}

function messageQueue(ws: WebSocket) {
  const queue: LiveServerMessage[] = [];
  const waiters: Waiter[] = [];

  ws.on("message", (raw) =>
    deliver(JSON.parse(raw.toString()) as LiveServerMessage, queue, waiters),
  );

  return (): Promise<LiveServerMessage> =>
    new Promise((resolve) => {
      const queued = queue.shift();

      return queued ? resolve(queued) : waiters.push(resolve);
    });
}

function deliver(
  message: LiveServerMessage,
  queue: LiveServerMessage[],
  waiters: Waiter[],
): void {
  const waiter = waiters.shift();

  if (waiter) {
    waiter(message);

    return;
  }
  queue.push(message);
}

/** Limits that admit the first `upgrades` upgrades and `opens` opens, from one fixed client address. */
export function allowing(
  upgrades: number,
  opens: number,
  address: string | null = "caller",
): LiveSocketLimits {
  let upgradesLeft = upgrades;
  let opensLeft = opens;

  return {
    addressOf: () => address ?? undefined,
    allowUpgrade: () => upgradesLeft-- > 0,
    allowOpen: () => opensLeft-- > 0,
  };
}

const ANA = { login: "ana", name: "Ana", avatarUrl: null, repos: ["o/r"] };
const BEN = { login: "ben", name: "Ben", avatarUrl: null, repos: ["x/y"] };

/** Two people: "ana-session" belongs to Ana (who reads o/r), "ben-session" to Ben (who reads x/y); any other token is no person's. */
export const personBySession: LiveSocketDeps["person"] = async (token) =>
  ({ "ana-session": ANA, "ben-session": BEN })[token] ?? null;

export const cookieOf = (session: string) => ({
  cookie: `theme=dark; lore_session=${session}`,
  origin: "http://localhost:3000",
});
