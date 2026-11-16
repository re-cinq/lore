// A `run` channel: the viewer's token names the run, the run's feed takes the viewer in, and every frame the feed forwards goes out as a `frame` envelope on the channel.

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { repoAllowed } from "../auth/login-grant.js";
import type { ChannelHandle } from "./channel-registry.js";
import {
  NO_SESSION,
  type SessionAccess,
  type SocketPerson,
} from "./socket-session.js";
import type { FrameSink } from "./frame-sink.js";
import type { LiveTokenVerifier } from "./live-tokens.js";
import type { Membership, RunFeedRegistry } from "./run-feed.js";
import type { RunStreamFrame } from "./run-stream-frame.js";
import type {
  ClosedReason,
  LiveServerMessage,
  OpenMessage,
} from "./protocol.js";

export type RunOpenMessage = Extract<OpenMessage, { kind: "run" }>;

export interface RunChannelDeps {
  verifyToken: LiveTokenVerifier;
  runs: Pick<AssemblyRunsPort, "getById">;
  feeds: Pick<RunFeedRegistry, "join">;
}

/** What a channel handler needs of its socket: a way to write envelopes and to read how far behind the wire is. */
export interface ChannelOutlet {
  send(message: LiveServerMessage): void;
  bufferedBytes(): number;
  /** The channel is over from the server's side; the registry forgets it. */
  ended(): void;
}

const CAPACITY_PREFIX = "run stream: ";

type Admission = { run: AssemblyRunRecord } | { reason: ClosedReason };

/** Opens the channel or explains why not: `opened` then the feed's frames, or one `closed` naming the refusal. Returns the handle the socket keeps, or null when nothing was opened. */
export async function openRunChannel(
  message: RunOpenMessage,
  outlet: ChannelOutlet,
  deps: RunChannelDeps,
  session: SessionAccess = NO_SESSION,
): Promise<ChannelHandle | null> {
  const { channel } = message;
  const admission = await admit(message, deps, session);
  const membership =
    "run" in admission ? joinFeed(admission.run, message, outlet, deps) : null;

  if (!membership) {
    const reason = "reason" in admission ? admission.reason : "capacity";

    outlet.send({ type: "closed", channel, reason });

    return null;
  }
  outlet.send({ type: "opened", channel });

  return { receive: () => {}, close: membership.leave };
}

async function admit(
  message: RunOpenMessage,
  deps: RunChannelDeps,
  session: SessionAccess,
): Promise<Admission> {
  const viewer = await viewerOf(message, deps, session);

  if (!viewer) {
    return { reason: "unauthorized" };
  }
  const run = await deps.runs.getById(message.subject);

  if (!run) {
    return { reason: "not_found" };
  }

  return repoAllowed({ user: viewer.person }, run.repo)
    ? { run }
    : { reason: "unauthorized" };
}

/** The viewer a minted token vouches for (no person: the token is the grant), or else the person the session cookie names; null for neither. */
async function viewerOf(
  message: RunOpenMessage,
  deps: RunChannelDeps,
  session: SessionAccess,
): Promise<{ person: SocketPerson | null } | null> {
  if (message.token === undefined) {
    const person = await session.person();

    return person ? { person } : null;
  }
  const minted = await deps.verifyToken(message.token, {
    kind: "run",
    subject: message.subject,
  });

  return minted ? { person: null } : null;
}

/** The feed refuses only past its per-run cap, as a plain Error with a known prefix; anything else is a bug and rethrows. */
function joinFeed(
  run: AssemblyRunRecord,
  message: RunOpenMessage,
  outlet: ChannelOutlet,
  deps: RunChannelDeps,
): Membership | null {
  try {
    return deps.feeds.join(
      run,
      frameSink(message.channel, outlet),
      message.after ?? "0",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(CAPACITY_PREFIX)) {
      return null;
    }
    throw err;
  }
}

function frameSink(channel: string, outlet: ChannelOutlet): FrameSink {
  return {
    send: (frame: RunStreamFrame) =>
      outlet.send({ type: "frame", channel, frame }),
    bufferedBytes: () => outlet.bufferedBytes(),
    end: (reason) => {
      outlet.send({
        type: "closed",
        channel,
        reason: reason === "slow" ? "slow" : "server",
      });
      outlet.ended();
    },
  };
}
