// The socket's reconnect and resubscribe logic as a pure reducer: an event in, a new state and the effects the client must run out. Nothing here opens a socket, sets a timer or fetches a token — the client does, and reports back as events.
import { reconnectAction } from "./backoff";
import type { ChannelKind, ClosedReason } from "./protocol";

export type SocketPhase = "idle" | "connecting" | "open" | "backoff" | "gone";
export type ChannelPhase = "pending" | "opening" | "open" | "closed";

/** What a channel's consumer is told; the run page maps it onto its chip. */
export type ChannelState = "connecting" | "live" | "reconnecting" | "offline";

export interface ChannelEntry {
  kind: ChannelKind;
  phase: ChannelPhase;
}

export interface MachineState {
  socket: SocketPhase;
  attempt: number;
  channels: Readonly<Record<string, ChannelEntry>>;
}

export type MachineEvent =
  | { type: "channel_requested"; id: string; kind: ChannelKind }
  | { type: "channel_released"; id: string }
  | { type: "socket_open" }
  | { type: "socket_closed" }
  | { type: "retry_due" }
  | { type: "server_opened"; id: string }
  | { type: "server_closed"; id: string; reason: ClosedReason }
  | { type: "open_failed"; id: string };

export type Effect =
  | { type: "connect" }
  | { type: "send_open"; id: string }
  | { type: "send_close"; id: string }
  | { type: "schedule_retry"; delayMs: number }
  | { type: "notify"; id: string; state: ChannelState };

export interface Transition {
  state: MachineState;
  effects: Effect[];
}

export const INITIAL_STATE: MachineState = {
  socket: "idle",
  attempt: 0,
  channels: {},
};

/** A channel that opens again after a close the server may recover from waits this long, so a refused open does not spin. */
const CHANNEL_RETRY_MS = 1000;

/** Closes that end the channel for good: the server will not change its mind, and the client asked for the last one. */
const FINAL_REASONS: ReadonlySet<ClosedReason> = new Set([
  "unauthorized",
  "not_found",
  "client",
]);

const REDUCERS: {
  [E in MachineEvent as E["type"]]: (
    state: MachineState,
    event: E,
  ) => Transition;
} = {
  channel_requested: onChannelRequested,
  channel_released: onChannelReleased,
  socket_open: onSocketOpen,
  socket_closed: onSocketClosed,
  retry_due: onRetryDue,
  server_opened: onServerOpened,
  server_closed: onServerClosed,
  open_failed: (state, event) => reopenLater(state, event.id),
};

export function reduce(state: MachineState, event: MachineEvent): Transition {
  return (
    REDUCERS[event.type] as (s: MachineState, e: MachineEvent) => Transition
  )(state, event);
}

/** A new channel: on an open socket it is sent at once; from idle or gone the socket is opened first; while connecting or backing off it waits its turn. */
function onChannelRequested(
  state: MachineState,
  event: Extract<MachineEvent, { type: "channel_requested" }>,
): Transition {
  const notify: Effect = { type: "notify", id: event.id, state: "connecting" };
  const phase = state.socket === "open" ? "opening" : "pending";
  const added = withChannel(state, event.id, { kind: event.kind, phase });

  if (state.socket === "open") {
    return {
      state: added,
      effects: [notify, { type: "send_open", id: event.id }],
    };
  }

  return needsSocket(state)
    ? {
        state: { ...added, socket: "connecting", attempt: 0 },
        effects: [notify, { type: "connect" }],
      }
    : { state: added, effects: [notify] };
}

const needsSocket = (state: MachineState): boolean =>
  state.socket === "idle" || state.socket === "gone";

/** The consumer is done: a channel on the wire is closed there; the socket stays up for the next page. */
function onChannelReleased(
  state: MachineState,
  event: Extract<MachineEvent, { type: "channel_released" }>,
): Transition {
  const entry = channelOf(state, event.id);
  const onWire =
    entry !== undefined && state.socket === "open" && isOnWire(entry);

  return {
    state: withoutChannel(state, event.id),
    effects: onWire ? [{ type: "send_close", id: event.id }] : [],
  };
}

const isOnWire = (entry: ChannelEntry): boolean =>
  entry.phase === "open" || entry.phase === "opening";

/** The socket is up: every channel waiting for it is opened. */
function onSocketOpen(state: MachineState): Transition {
  const ids = idsInPhase(state, "pending");

  return {
    state: {
      ...state,
      socket: "open",
      attempt: 0,
      channels: rephased(state, ids, "opening"),
    },
    effects: ids.map((id) => ({ type: "send_open", id })),
  };
}

/** The socket dropped: every live channel goes back to waiting and a retry is scheduled, unless the attempts are spent. */
function onSocketClosed(state: MachineState): Transition {
  const survivors = Object.entries(state.channels)
    .filter(([, entry]) => entry.phase !== "closed")
    .map(([id]) => id);
  const channels = rephased(state, survivors, "pending");

  if (survivors.length === 0) {
    return {
      state: { ...state, socket: "idle", attempt: 0, channels },
      effects: [],
    };
  }

  return retryOrGiveUp({ ...state, channels }, survivors);
}

function retryOrGiveUp(state: MachineState, survivors: string[]): Transition {
  const attempt = state.attempt + 1;
  const action = reconnectAction(attempt);
  const notify = (channelState: ChannelState): Effect[] =>
    survivors.map((id) => ({ type: "notify", id, state: channelState }));

  if (action.kind === "give-up") {
    return {
      state: { ...state, socket: "gone", attempt },
      effects: notify("offline"),
    };
  }

  return {
    state: { ...state, socket: "backoff", attempt },
    effects: [
      ...notify("reconnecting"),
      { type: "schedule_retry", delayMs: action.delayMs },
    ],
  };
}

/** The retry timer fired: a backed-off socket connects again; an open one re-sends the channels waiting on it. */
function onRetryDue(state: MachineState): Transition {
  if (state.socket === "backoff") {
    return {
      state: { ...state, socket: "connecting" },
      effects: [{ type: "connect" }],
    };
  }

  if (state.socket !== "open") {
    return { state, effects: [] };
  }
  const ids = idsInPhase(state, "pending");

  return {
    state: { ...state, channels: rephased(state, ids, "opening") },
    effects: ids.map((id) => ({ type: "send_open", id })),
  };
}

function onServerOpened(
  state: MachineState,
  event: Extract<MachineEvent, { type: "server_opened" }>,
): Transition {
  const entry = channelOf(state, event.id);

  if (entry === undefined) {
    return { state, effects: [] };
  }

  return {
    state: withChannel(state, event.id, { ...entry, phase: "open" }),
    effects: [{ type: "notify", id: event.id, state: "live" }],
  };
}

/** A final refusal ends the channel; anything else (slow, a server hiccup, capacity) is worth another try after a pause. */
function onServerClosed(
  state: MachineState,
  event: Extract<MachineEvent, { type: "server_closed" }>,
): Transition {
  const entry = channelOf(state, event.id);

  if (entry === undefined) {
    return { state, effects: [] };
  }

  if (FINAL_REASONS.has(event.reason)) {
    return {
      state: withChannel(state, event.id, { ...entry, phase: "closed" }),
      effects: [{ type: "notify", id: event.id, state: "offline" }],
    };
  }

  return reopenLater(state, event.id);
}

function reopenLater(state: MachineState, id: string): Transition {
  const entry = channelOf(state, id);

  if (entry === undefined) {
    return { state, effects: [] };
  }

  return {
    state: withChannel(state, id, { ...entry, phase: "pending" }),
    effects: [
      { type: "notify", id, state: "reconnecting" },
      { type: "schedule_retry", delayMs: CHANNEL_RETRY_MS },
    ],
  };
}

function channelOf(state: MachineState, id: string): ChannelEntry | undefined {
  return Object.hasOwn(state.channels, id) ? state.channels[id] : undefined;
}

function withChannel(
  state: MachineState,
  id: string,
  entry: ChannelEntry,
): MachineState {
  return { ...state, channels: { ...state.channels, [id]: entry } };
}

function withoutChannel(state: MachineState, id: string): MachineState {
  const { [id]: _gone, ...channels } = state.channels;

  return { ...state, channels };
}

function idsInPhase(state: MachineState, phase: ChannelPhase): string[] {
  return Object.entries(state.channels)
    .filter(([, entry]) => entry.phase === phase)
    .map(([id]) => id);
}

/** The channels named, moved to one phase; the rest untouched. */
function rephased(
  state: MachineState,
  ids: readonly string[],
  phase: ChannelPhase,
): MachineState["channels"] {
  const channels = { ...state.channels };

  for (const id of ids) {
    channels[id] = { ...channels[id], phase };
  }

  return channels;
}
