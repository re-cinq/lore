import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { ProxyMessage } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { agentEventsRoutes } from "./agent-events.js";

const CENTRAL = "central-ingest-token";
const PER_AGENT = "satellite-per-agent-token";
const NDJSON = '{"type":"assistant"}\n{"type":"result"}\n';

let emitted: ProxyMessage[];

function build(tokens: Array<string | undefined>): Hapi.Server {
  const app = Hapi.server({ port: 0 });

  app.route(
    agentEventsRoutes({
      emit: async (message) => {
        emitted.push(message);
      },
      acceptedTokens: () => tokens,
    }),
  );

  return app;
}

const post = (app: Hapi.Server, token: string | undefined, payload = NDJSON) =>
  app.inject({
    method: "POST",
    url: "/api/cluster/agent-events",
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    payload,
  });

beforeEach(() => {
  emitted = [];
});

describe("agent-events relay", () => {
  it("queues the body verbatim, so the pod's NDJSON is not reshaped in transit", async () => {
    const res = await post(build([CENTRAL]), CENTRAL);

    expect(res.statusCode).toBe(202);
    expect(emitted).toEqual([{ kind: "telemetry", body: NDJSON }]);
  });

  it("accepts the satellite's own per-agent token, which is the only one it holds", async () => {
    const res = await post(build([undefined, PER_AGENT]), PER_AGENT);

    expect({ status: res.statusCode, count: emitted.length }).toEqual({
      status: 202,
      count: 1,
    });
  });

  it("refuses a token that matches none of the accepted ones", async () => {
    const res = await post(build([CENTRAL, PER_AGENT]), "not-our-token");

    expect({ status: res.statusCode, count: emitted.length }).toEqual({
      status: 401,
      count: 0,
    });
  });

  it("refuses when this cluster holds no credential yet, rather than accepting anything", async () => {
    const res = await post(build([undefined, undefined]), "anything");

    expect({ status: res.statusCode, count: emitted.length }).toEqual({
      status: 500,
      count: 0,
    });
  });

  it("refuses a request carrying no authorization header", async () => {
    const res = await post(build([CENTRAL]), undefined);

    expect(res.statusCode).toBe(401);
  });

  it("refuses a body past the cap rather than queueing it", async () => {
    const res = await post(build([CENTRAL]), CENTRAL, "x".repeat(9_000_000));

    expect({ status: res.statusCode, count: emitted.length }).toEqual({
      status: 413,
      count: 0,
    });
  });
});
