import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const SLACK_SECRET = "slack-secret";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function slackEvent(body: object, opts: { sign?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000)); // eslint-disable-line re-lint/no-nondeterministic-tests -- clock pinned for the file by useRateLimitSafeClock()
  const sig =
    "v0=" +
    createHmac("sha256", SLACK_SECRET).update(`v0:${ts}:${raw}`).digest("hex");

  return buildServer(() => makePool() as never).inject({
    method: "POST",
    url: "/api/webhook/slack-events",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": ts,
      "x-slack-signature": opts.sign === false ? "v0=bad" : sig,
    },
    payload: raw,
  });
}

const reaction = (name: string) => ({
  type: "event_callback",
  event: {
    type: "reaction_added",
    reaction: name,
    item: { type: "message", channel: "C0LORE", ts: "1790590000.000100" },
  },
});

describe("POST /api/webhook/slack-events", () => {
  useRateLimitSafeClock();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.LORE_SLACK_SIGNING_SECRET = SLACK_SECRET;
    process.env.LORE_SLACK_BOT_TOKEN = "xoxb-test";
    fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("answers the url_verification handshake with its challenge", async () => {
    const res = await slackEvent({
      type: "url_verification",
      challenge: "challenge-3eZbrw1a",
    });

    expect({ status: res.statusCode, body: res.payload }).toEqual({
      status: 200,
      body: "challenge-3eZbrw1a",
    });
  });

  it("deletes message 1790590000.000100 in C0LORE when someone reacts with wastebasket", async () => {
    const res = await slackEvent(reaction("wastebasket"));

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect({
      url,
      auth: (init.headers as Record<string, string>).Authorization,
      body: JSON.parse(String(init.body)),
    }).toEqual({
      url: "https://slack.com/api/chat.delete",
      auth: "Bearer xoxb-test",
      body: { channel: "C0LORE", ts: "1790590000.000100" },
    });
  });

  it("deletes nothing for a thumbsup reaction", async () => {
    const res = await slackEvent(reaction("+1"));

    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a bad signature with 401 and deletes nothing", async () => {
    const res = await slackEvent(reaction("wastebasket"), { sign: false });

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
