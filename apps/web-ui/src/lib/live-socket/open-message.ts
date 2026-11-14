import type { ChannelSpec } from "./client";
import type { ChannelKind, LiveClientMessage } from "./protocol";

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
  "plan-run": (id, spec, token) => ({
    type: "open",
    channel: id,
    kind: "plan-run",
    subject: spec.subject,
    token,
  }),
};

/** The `open` a channel of this kind sends; a channel with no token of its own sends an empty one. */
export function openMessage(
  id: string,
  spec: ChannelSpec,
  token: string | undefined,
): LiveClientMessage {
  return OPEN_MESSAGES[spec.kind](id, spec, token ?? "");
}
