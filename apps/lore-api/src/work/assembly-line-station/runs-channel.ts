// The `runs` channel of the live socket: the list of the floor's runs, live. A viewer joins the one feed the process keeps on the floor, says which runs are on its page, and is told of each run that starts and of every change to the ones it watches.

import { LIVE_RUNS_SUBJECT } from "@re-cinq/lore-shared/models/live-token.js";
import type { FloorRunsFeed, RunsViewer } from "../floor/floor-runs-feed.js";
import type { ChannelHandle } from "./channel-registry.js";
import type { EndReason } from "./frame-sink.js";
import type { LiveTokenVerifier } from "./live-tokens.js";
import type { OpenMessage } from "./protocol.js";
import { NO_SESSION, type SessionAccess } from "./socket-session.js";
import type { ChannelOutlet } from "./run-channel.js";
import { HIGH_WATER_MARK } from "./run-feed.js";

export type RunsOpenMessage = Extract<OpenMessage, { kind: "runs" }>;

export interface RunsChannelDeps {
  verifyToken: LiveTokenVerifier;
  /** Null where no floor is configured: there is no list to follow. */
  feed: Pick<FloorRunsFeed, "join"> | null;
}

/** Opens the channel or explains why not: `opened` then the feed's frames, or one `closed` naming the refusal. Returns the handle the socket keeps, or null when nothing was opened. */
export async function openRunsChannel(
  message: RunsOpenMessage,
  outlet: ChannelOutlet,
  deps: RunsChannelDeps,
  session: SessionAccess = NO_SESSION,
): Promise<ChannelHandle | null> {
  const { channel } = message;
  const refusal = (await isAdmitted(message, deps, session))
    ? null
    : "unauthorized";

  if (!deps.feed || refusal) {
    outlet.send({ type: "closed", channel, reason: refusal ?? "not_found" });

    return null;
  }

  return follow(channel, outlet, deps.feed);
}

function follow(
  channel: string,
  outlet: ChannelOutlet,
  feed: Pick<FloorRunsFeed, "join">,
): ChannelHandle {
  outlet.send({ type: "opened", channel });
  const membership = feed.join(runsViewer(channel, outlet, () => membership));

  return {
    receive: () => {},
    close: () => membership.leave(),
    watch: (runIds) => membership.watch(runIds),
  };
}

async function isAdmitted(
  message: RunsOpenMessage,
  deps: RunsChannelDeps,
  session: SessionAccess,
): Promise<boolean> {
  const viewer =
    message.token === undefined
      ? await session.person()
      : await deps.verifyToken(message.token, {
          kind: "runs",
          subject: message.subject,
        });

  return message.subject === LIVE_RUNS_SUBJECT && viewer !== null;
}

function runsViewer(
  channel: string,
  outlet: ChannelOutlet,
  membership: () => { leave(): void },
): RunsViewer {
  const end: RunsViewer["end"] = (reason) => {
    membership().leave();
    outlet.send({ type: "closed", channel, reason: closedReasonOf(reason) });
    outlet.ended();
  };

  return {
    send: (frame) =>
      outlet.bufferedBytes() > HIGH_WATER_MARK
        ? end("slow")
        : outlet.send({ type: "runs", channel, frame }),
    end,
  };
}

function closedReasonOf(reason: EndReason): "slow" | "server" {
  return reason === "slow" ? "slow" : "server";
}
