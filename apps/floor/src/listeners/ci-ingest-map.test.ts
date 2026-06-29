import { describe, it, expect } from "vitest";
import { mapCiIngest } from "./ci-ingest-map.js";

describe("mapCiIngest", () => {
  it("maps one doc kind to one internal.ingest.spec_trace event carrying repo/kind/payload", () => {
    const result = mapCiIngest({ repo: "re-cinq/lore", kinds: ["specs"], commit: "abc123", force: true });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: { repo: "re-cinq/lore", kind: "specs", payload: { commit: "abc123", force: true } },
        },
      ],
    });
  });

  it("maps both doc kinds to one event each, preserving requested order", () => {
    const result = mapCiIngest({ repo: "re-cinq/lore", kinds: ["adrs", "specs"], commit: "deadbeef" });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: { repo: "re-cinq/lore", kind: "adrs", payload: { commit: "deadbeef", force: undefined } },
        },
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: { repo: "re-cinq/lore", kind: "specs", payload: { commit: "deadbeef", force: undefined } },
        },
      ],
    });
  });

  it("defaults to both doc kinds when kinds is omitted", () => {
    const result = mapCiIngest({ repo: "re-cinq/lore", commit: "c0ffee" });
    expect(result).toMatchObject({
      ok: true,
      events: [
        { params: { kind: "specs" } },
        { params: { kind: "adrs" } },
      ],
    });
  });

  it("rejects a non-doc kind with a 400 naming the unsupported kind", () => {
    const result = mapCiIngest({ repo: "re-cinq/lore", kinds: ["tests"], commit: "abc" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "unsupported kind(s): tests — only specs/adrs project here; test projection is CI-only (POST /test-report + /coverage)",
    });
  });

  it("rejects the whole batch when any kind is unsupported", () => {
    const result = mapCiIngest({ repo: "re-cinq/lore", kinds: ["specs", "tests"], commit: "abc" });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a missing repo with a 400", () => {
    const result = mapCiIngest({ kinds: ["specs"], commit: "abc" });
    expect(result).toEqual({ ok: false, status: 400, error: "missing repo" });
  });
});
