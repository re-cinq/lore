import type { ChannelHandle } from "./channel-registry.js";
import type { LiveSocketDeps } from "./live-socket.js";
import { openPlanChannel } from "./plan-channel.js";
import { openPlanRunChannel } from "./plan-run-channel.js";
import type { OpenMessage } from "./protocol.js";
import { openRunChannel, type ChannelOutlet } from "./run-channel.js";
import { openRunsChannel } from "./runs-channel.js";
import type { SessionAccess } from "./socket-session.js";

export interface OpenContext {
  deps: LiveSocketDeps;
  /** The upgrade request as a web Request, for the plan channel's collaboration handshake. */
  request: () => Request;
  /** Who the socket's session cookie names, resolved when asked so a signed-out session is refused. */
  session: SessionAccess;
}

export type Opener<M extends OpenMessage> = (
  message: M,
  outlet: ChannelOutlet,
  context: OpenContext,
) => Promise<ChannelHandle | null>;

/** Each channel kind's handler. */
export const OPENERS: {
  [K in OpenMessage["kind"]]: Opener<Extract<OpenMessage, { kind: K }>>;
} = {
  plan: async (message, outlet, { deps, request }) =>
    openPlanChannel(message.channel, request(), outlet, deps.collab),
  run: (message, outlet, { deps, session }) =>
    openRunChannel(message, outlet, deps.run, session),
  runs: (message, outlet, { deps, session }) =>
    openRunsChannel(message, outlet, deps.runs, session),
  "plan-run": (message, outlet, { deps }) =>
    openPlanRunChannel(message, outlet, deps.planRun),
};
