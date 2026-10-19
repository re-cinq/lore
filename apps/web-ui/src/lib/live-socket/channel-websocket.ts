// A plan channel wearing a WebSocket's face, so Hocuspocus's provider can be handed the tab's shared socket as its `WebSocketPolyfill` and never know the difference: bytes in and out, open/close/error events, a readyState.
import type { LiveSocketClient, ChannelHandle } from "./client";
import type { ChannelState } from "./connection-machine";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** What a close carries; a plain event with the two fields Hocuspocus reads, since jsdom has no CloseEvent. */
class ChannelCloseEvent extends Event {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close");
  }
}

/** A closed-by-the-server channel reads to Hocuspocus as an abnormal close, so its own retry loop kicks in. */
const ABNORMAL_CLOSE = 1006;

export interface ChannelWebSocket extends EventTarget {
  readyState: number;
  binaryType: string;
  send(bytes: Uint8Array): void;
  close(): void;
}

/** The polyfill class for one plan: every instance Hocuspocus constructs opens one channel on the shared socket. */
export function channelWebSocketFor(
  client: LiveSocketClient,
  subject: string,
): new (url: string) => ChannelWebSocket {
  return class extends ChannelSocket {
    constructor(_url: string) {
      super(client, subject);
    }
  };
}

// eslint-disable-next-line re-lint/no-hybrid-class -- the browser WebSocket shape Hocuspocus reads: readyState and binaryType are its public fields
class ChannelSocket extends EventTarget implements ChannelWebSocket {
  readyState = CONNECTING;
  binaryType = "arraybuffer";
  private readonly handle: ChannelHandle;

  constructor(client: LiveSocketClient, subject: string) {
    super();
    this.handle = client.open({
      kind: "plan",
      subject,
      onData: (bytes) => this.deliver(bytes),
      onState: (state) => this.onState(state),
    });
  }

  send(bytes: Uint8Array): void {
    this.handle.send(bytes);
  }

  close(): void {
    if (this.readyState === CLOSED) {
      return;
    }
    this.handle.close();
    this.end(1000, "client");
  }

  private deliver(bytes: Uint8Array): void {
    const copy = new Uint8Array(bytes);

    this.dispatchEvent(new MessageEvent("message", { data: copy.buffer }));
  }

  /** Live means open; anything after that is a close. Hocuspocus reconnects by constructing a fresh instance, so this one releases its channel first, or every retry would leave one more pending channel on the client for the socket to re-open. */
  private onState(state: ChannelState): void {
    if (state === "live") {
      this.readyState = OPEN;
      this.dispatchEvent(new Event("open"));

      return;
    }

    if (state !== "connecting") {
      this.handle.close();
      this.dispatchEvent(new Event("error"));
      this.end(ABNORMAL_CLOSE, state);
    }
  }

  private end(code: number, reason: string): void {
    if (this.readyState === CLOSED) {
      return;
    }
    this.readyState = CLOSED;
    this.dispatchEvent(new ChannelCloseEvent(code, reason));
  }
}
