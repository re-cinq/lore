import { WebSocket } from "ws";
import type { LiveServerMessage } from "./protocol.js";

type Waiter = (message: LiveServerMessage) => void;

export function queuedClient(port: number, path = "/api/ws") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);

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
