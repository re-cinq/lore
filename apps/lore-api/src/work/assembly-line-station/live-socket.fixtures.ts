import { WebSocket } from "ws";
import type { LiveServerMessage } from "./protocol.js";

export function queuedClient(port: number, path = "/api/ws") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  const queue: LiveServerMessage[] = [];
  const waiters: ((m: LiveServerMessage) => void)[] = [];

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as LiveServerMessage;
    const waiter = waiters.shift();

    if (waiter) {
      waiter(message);

      return;
    }
    queue.push(message);
  });

  return {
    ws,
    open: () =>
      new Promise<void>((resolve) => ws.once("open", () => resolve())),
    send: (message: object) => ws.send(JSON.stringify(message)),
    next: () =>
      new Promise<LiveServerMessage>((resolve) => {
        const queued = queue.shift();

        if (queued) {
          resolve(queued);

          return;
        }
        waiters.push(resolve);
      }),
    closed: () => new Promise<number>((resolve) => ws.once("close", resolve)),
  };
}
