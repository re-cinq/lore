// A WebSocket the tests drive by hand: it records what the client sent and lets a test play the server.
import type { SocketLike } from "./client";
import type { LiveClientMessage, LiveServerMessage } from "./protocol";

// eslint-disable-next-line re-lint/no-hybrid-class -- a stand-in for the browser's WebSocket, whose public fields are the contract
export class FakeWebSocket implements SocketLike {
  static instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static get latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);

    if (!socket) {
      throw new Error("no FakeWebSocket has been constructed");
    }

    return socket;
  }

  readyState = 0;
  closed = false;
  readonly sent: LiveClientMessage[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text) as LiveClientMessage);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "" } as CloseEvent);
  }

  /** The server accepted the upgrade. */
  accept(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  /** The server went away. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" } as CloseEvent);
  }

  receive(message: LiveServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  /** The channel ids the client asked to open, in order. */
  get opens(): Extract<LiveClientMessage, { type: "open" }>[] {
    return this.sent.filter((m) => m.type === "open");
  }

  /** Accepts the upgrade, lets the client fetch its tokens, then answers every open with `opened`. */
  async acceptAndOpenAll(): Promise<void> {
    this.accept();
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const open of this.opens) {
      this.receive({ type: "opened", channel: open.channel });
    }
  }
}
