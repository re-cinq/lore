// The tab's one live socket (ADR-048): opens lazily for the first channel, multiplexes every channel a page asks for, and survives a page change because nothing here belongs to a page. Every decision is the connection machine's; this is the IO shell that runs its effects and feeds it what the wire says.
import { jittered } from "./backoff";
import {
  INITIAL_STATE,
  reduce,
  type ChannelState,
  type Effect,
  type MachineEvent,
  type MachineState,
} from "./connection-machine";
import {
  base64ToBytes,
  bytesToBase64,
  decodeServerMessage,
  encodeClientMessage,
  type ChannelKind,
  type LiveClientMessage,
  type LiveServerMessage,
  type RunListFrame,
} from "./protocol";
import type { RunStreamFrame } from "@/lib/run-stream-types";

/** The slice of the browser's WebSocket the client drives, so a test can hand in its own. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send(text: string): void;
  close(): void;
}

export type SocketConstructor = new (url: string) => SocketLike;

export interface ChannelSpec {
  kind: ChannelKind;
  subject: string;
  /** Fetched fresh for every open, so a reconnect never re-sends an expired token. */
  token?: () => Promise<string>;
  /** Read at every open, so a resumed channel replays from the newest event seen. */
  after?: () => string;
  onFrame?: (frame: RunStreamFrame) => void;
  onRunsFrame?: (frame: RunListFrame) => void;
  onData?: (bytes: Uint8Array) => void;
  onState?: (state: ChannelState) => void;
}

export interface ChannelHandle {
  send(bytes: Uint8Array): void;
  /** Says which runs a list channel hears changes of; the set is remembered and sent again by itself on every re-open. */
  watch(runIds: readonly string[]): void;
  close(): void;
}

export interface LiveSocketOptions {
  url: string;
  socket?: SocketConstructor;
  setTimer?: (fn: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  random?: () => number;
}

const OPEN = 1;

// Timer keys: the socket's own is a key no channel id can spell, since a channel's is its id.
const SOCKET_TIMER = "socket:";

export class LiveSocketClient {
  private state: MachineState = INITIAL_STATE;
  private socket: SocketLike | null = null;
  // One timer per waiting channel: a channel waiting 16s must hold neither the socket's reconnect nor another channel's.
  private readonly timers = new Map<string, unknown>();
  private readonly specs = new Map<string, ChannelSpec>();
  private readonly watched = new Map<string, readonly string[]>();
  private nextId = 0;

  constructor(private readonly options: LiveSocketOptions) {}

  get phase(): MachineState["socket"] {
    return this.state.socket;
  }

  open(spec: ChannelSpec): ChannelHandle {
    const id = `c${++this.nextId}`;

    this.specs.set(id, spec);
    this.dispatch({ type: "channel_requested", id, kind: spec.kind });

    return {
      send: (bytes) => this.sendOn(id, bytes),
      watch: (runIds) => {
        this.watched.set(id, runIds);
        this.sendWatch(id);
      },
      close: () => {
        this.specs.delete(id);
        this.watched.delete(id);
        this.dispatch({ type: "channel_released", id });
      },
    };
  }

  dispatch(event: MachineEvent): void {
    const { state, effects } = reduce(this.state, event);

    this.state = state;

    for (const effect of effects) {
      this.run(effect);
    }
  }

  private run(effect: Effect): void {
    EFFECTS[effect.type](this, effect as never);
  }

  notify(id: string, state: ChannelState): void {
    this.specs.get(id)?.onState?.(state);
  }

  connect(): void {
    const Socket = this.options.socket ?? WebSocket;
    const socket = new Socket(this.options.url);

    this.socket = socket;
    socket.onopen = () => this.ifCurrent(socket, { type: "socket_open" });
    socket.onclose = () => this.ifCurrent(socket, { type: "socket_closed" });
    socket.onerror = null;
    socket.onmessage = (event) => this.receive(String(event.data));
  }

  /** A stale socket's events must not drive the machine: the client may already be on its successor. */
  private ifCurrent(socket: SocketLike, event: MachineEvent): void {
    if (this.socket === socket) {
      this.dispatch(event);
    }
  }

  send(message: LiveClientMessage): void {
    if (this.socket !== null && this.socket.readyState === OPEN) {
      this.socket.send(encodeClientMessage(message));
    }
  }

  private sendOn(id: string, bytes: Uint8Array): void {
    if (this.phaseOf(id) === "open") {
      this.send({ type: "send", channel: id, data: bytesToBase64(bytes) });
    }
  }

  sendWatch(id: string): void {
    const runs = this.watched.get(id);

    if (runs !== undefined && this.phaseOf(id) === "open") {
      this.send({ type: "watch", channel: id, runs: [...runs] });
    }
  }

  private phaseOf(id: string): string | undefined {
    return Object.hasOwn(this.state.channels, id)
      ? this.state.channels[id].phase
      : undefined;
  }

  /** The open goes out once the token is in hand; a channel released or a socket lost meanwhile drops it on the floor. */
  async sendOpen(id: string): Promise<void> {
    const spec = this.specs.get(id);

    if (!spec) {
      return;
    }

    try {
      const token = spec.token ? await spec.token() : undefined;

      if (this.phaseOf(id) === "opening") {
        this.send(openMessage(id, spec, token));
      }
    } catch {
      this.dispatch({ type: "open_failed", id });
    }
  }

  /** One pending retry at a time: whichever fires serves both a backed-off socket and the channels waiting to re-open. */
  scheduleRetry(delayMs: number, id?: string): void {
    const key = id === undefined ? SOCKET_TIMER : `channel:${id}`;

    if (this.timers.has(key)) {
      return;
    }
    const setTimer = this.options.setTimer ?? setTimeout;

    this.timers.set(
      key,
      setTimer(
        () => {
          this.timers.delete(key);
          this.dispatch({ type: "retry_due", ...(id ? { id } : {}) });
        },
        jittered(delayMs, this.options.random),
      ),
    );
  }

  private receive(text: string): void {
    const message = decodeServerMessage(text);

    if (message !== null) {
      INBOUND[message.type](this, message as never);
    }
  }

  deliverFrame(channel: string, frame: RunStreamFrame): void {
    this.specs.get(channel)?.onFrame?.(frame);
  }

  deliverRunsFrame(channel: string, frame: RunListFrame): void {
    this.specs.get(channel)?.onRunsFrame?.(frame);
  }

  deliverData(channel: string, encoded: string): void {
    this.specs.get(channel)?.onData?.(base64ToBytes(encoded));
  }

  /** A channel the server could not take (its id clashed or the socket is full) is retried like a server close; a socket-level error has nothing to retry. */
  onError(message: Extract<LiveServerMessage, { type: "error" }>): void {
    if (message.channel !== undefined && message.code !== "unknown_channel") {
      this.dispatch({
        type: "server_closed",
        id: message.channel,
        reason: "server",
      });
    }
  }
}

/** Access the client grants its two dispatch tables; private otherwise. */
interface ClientInternals {
  connect(): void;
  sendOpen(id: string): Promise<void>;
  send(message: LiveClientMessage): void;
  scheduleRetry(delayMs: number, id?: string): void;
  notify(id: string, state: ChannelState): void;
  dispatch(event: MachineEvent): void;
  deliverFrame(channel: string, frame: RunStreamFrame): void;
  deliverRunsFrame(channel: string, frame: RunListFrame): void;
  deliverData(channel: string, encoded: string): void;
  sendWatch(id: string): void;
  onError(message: Extract<LiveServerMessage, { type: "error" }>): void;
}

const EFFECTS: {
  [E in Effect as E["type"]]: (client: ClientInternals, effect: E) => void;
} = {
  connect: (client) => client.connect(),
  send_open: (client, effect) => void client.sendOpen(effect.id),
  send_close: (client, effect) =>
    client.send({ type: "close", channel: effect.id }),
  schedule_retry: (client, effect) =>
    client.scheduleRetry(effect.delayMs, effect.id),
  notify: (client, effect) => client.notify(effect.id, effect.state),
};

const INBOUND: {
  [M in LiveServerMessage as M["type"]]: (
    client: ClientInternals,
    message: M,
  ) => void;
} = {
  opened: (client, message) => {
    client.dispatch({ type: "server_opened", id: message.channel });
    client.sendWatch(message.channel);
  },
  frame: (client, message) =>
    client.deliverFrame(message.channel, message.frame),
  runs: (client, message) =>
    client.deliverRunsFrame(message.channel, message.frame),
  data: (client, message) => client.deliverData(message.channel, message.data),
  closed: (client, message) =>
    client.dispatch({
      type: "server_closed",
      id: message.channel,
      reason: message.reason,
    }),
  error: (client, message) => client.onError(message),
};

const OPEN_MESSAGES: {
  [K in ChannelKind]: (
    id: string,
    spec: ChannelSpec,
    token: string,
  ) => LiveClientMessage;
} = {
  plan: (id, spec) => ({
    type: "open",
    channel: id,
    kind: "plan",
    subject: spec.subject,
  }),
  run: (id, spec, token) => ({
    type: "open",
    channel: id,
    kind: "run",
    subject: spec.subject,
    token,
    after: spec.after?.(),
  }),
  runs: (id, spec, token) => ({
    type: "open",
    channel: id,
    kind: "runs",
    subject: spec.subject,
    token,
  }),
};

function openMessage(
  id: string,
  spec: ChannelSpec,
  token: string | undefined,
): LiveClientMessage {
  return OPEN_MESSAGES[spec.kind](id, spec, token ?? "");
}
