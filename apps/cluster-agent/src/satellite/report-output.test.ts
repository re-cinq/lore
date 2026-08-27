import { describe, it, expect } from "vitest";
import { reportTerminalOutput } from "./report-output.js";

const IDENTITY = { id: "agent-1", token: "lca_secret", name: "minikube" };
const ok = new Response(null, { status: 204 });

describe("reportTerminalOutput", () => {
  it("posts the output to the reporting agent's own complete endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    await reportTerminalOutput({
      apiUrl: "https://lore-api.example",
      identity: () => IDENTITY,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });

        return ok;
      }) as unknown as typeof fetch,
    })("sr-1", "REVIEW_RESULT:APPROVED");

    expect(calls[0].url).toBe(
      "https://lore-api.example/api/cluster-agents/agent-1/complete",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      station_run_id: "sr-1",
      output: "REVIEW_RESULT:APPROVED",
    });
  });

  it("authenticates with the per-agent token, resolved per call", async () => {
    let token = "lca_first";
    const seen: string[] = [];
    const report = reportTerminalOutput({
      apiUrl: "https://lore-api.example",
      identity: () => ({ ...IDENTITY, token }),
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen.push(
          String((init.headers as Record<string, string>).authorization),
        );

        return ok;
      }) as unknown as typeof fetch,
    });

    await report("sr-1", "out");
    token = "lca_rotated";
    await report("sr-2", "out");

    expect(seen).toEqual(["Bearer lca_first", "Bearer lca_rotated"]);
  });

  it("throws on a refused report, so the caller can log it as the failure it is", async () => {
    const report = reportTerminalOutput({
      apiUrl: "https://lore-api.example",
      identity: () => IDENTITY,
      fetchImpl: (async () =>
        new Response(null, { status: 403 })) as unknown as typeof fetch,
    });

    await expect(report("sr-1", "out")).rejects.toThrow(
      new Error("terminal output report refused: HTTP 403"),
    );
  });
});
