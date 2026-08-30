import { describe, it, expect } from "vitest";
import type { ClusterAgent } from "../../models/cluster-agent.js";
import { capacityFor, unclaimedDetail } from "./capacity.js";

const agent = (
  name: string,
  tags: string[],
  overrides: Partial<ClusterAgent> = {},
): ClusterAgent => ({
  id: `id-${name}`,
  name,
  tags,
  tokenHash: "hash",
  registeredAt: new Date("2026-08-01T00:00:00Z"),
  lastSeenAt: new Date("2026-08-30T00:00:00Z"),
  status: "active",
  paused: false,
  clusterInfo: null,
  ...overrides,
});

const CENTRAL_TAGS = ["node:agent", "node:validate", "node:comment-triage"];

describe("capacityFor", () => {
  it("returns capable with the agents that can take the work", () => {
    const central = agent("central", CENTRAL_TAGS);

    expect(capacityFor(["node:validate"], [central])).toEqual({
      kind: "capable",
      agents: [central],
    });
  });

  it("returns registry-empty when nobody has ever registered", () => {
    expect(capacityFor(["node:validate"], [])).toEqual({
      kind: "registry-empty",
    });
  });

  it("returns none-registered when the registry has agents but none offers the tag", () => {
    expect(
      capacityFor(["node:validate"], [agent("satellite", ["node:agent"])]),
    ).toEqual({
      kind: "none-registered",
      reason: "no registered cluster-agent offers [node:validate]",
    });
  });

  it("returns all-unavailable naming the paused agent that is the only provider", () => {
    expect(
      capacityFor(
        ["node:validate"],
        [
          agent("central", CENTRAL_TAGS, { paused: true }),
          agent("satellite", ["node:agent"]),
        ],
      ),
    ).toEqual({
      kind: "all-unavailable",
      reason:
        "every cluster-agent offering [node:validate] is unavailable: central (paused)",
    });
  });

  it("names each unavailable provider and why, when several match", () => {
    expect(
      capacityFor(
        ["node:validate"],
        [
          agent("central", CENTRAL_TAGS, { paused: true }),
          agent("gpu-1", ["node:validate"], { status: "offline" }),
        ],
      ),
    ).toMatchObject({
      kind: "all-unavailable",
      reason:
        "every cluster-agent offering [node:validate] is unavailable: central (paused), gpu-1 (offline)",
    });
  });

  it("is capable when one provider is paused and another is not", () => {
    const live = agent("gpu-1", ["node:validate"]);

    expect(
      capacityFor(
        ["node:validate"],
        [agent("central", CENTRAL_TAGS, { paused: true }), live],
      ),
    ).toEqual({ kind: "capable", agents: [live] });
  });

  it("requires every tag, not just one of them", () => {
    expect(
      capacityFor(["node:agent", "gpu"], [agent("central", CENTRAL_TAGS)]),
    ).toMatchObject({ kind: "none-registered" });
  });
});

describe("unclaimedDetail", () => {
  it("names the paused provider rather than reporting nobody registered", () => {
    expect(
      unclaimedDetail({
        requiredTags: ["node:validate"],
        waitMinutes: 30,
        verdict: capacityFor(
          ["node:validate"],
          [agent("central", CENTRAL_TAGS, { paused: true })],
        ),
      }),
    ).toEqual(
      "no cluster-agent claimed this run (required_tags: [node:validate]) within 30m — every cluster-agent offering [node:validate] is unavailable: central (paused)",
    );
  });

  it("says a capable agent was active but did not claim, which reads as wedged", () => {
    expect(
      unclaimedDetail({
        requiredTags: ["node:validate"],
        waitMinutes: 30,
        verdict: capacityFor(
          ["node:validate"],
          [agent("central", CENTRAL_TAGS)],
        ),
      }),
    ).toEqual(
      "no cluster-agent claimed this run (required_tags: [node:validate]) within 30m — 1 capable cluster-agent (central) was active but did not claim it; it may be wedged",
    );
  });

  it("pluralizes when several capable agents all ignored it", () => {
    expect(
      unclaimedDetail({
        requiredTags: ["node:agent"],
        waitMinutes: 30,
        verdict: capacityFor(
          ["node:agent"],
          [agent("central", CENTRAL_TAGS), agent("satellite", ["node:agent"])],
        ),
      }),
    ).toContain(
      "2 capable cluster-agents (central, satellite) were active but did not claim it; they may be wedged",
    );
  });

  it("says so plainly when the registry is empty", () => {
    expect(
      unclaimedDetail({
        requiredTags: ["node:ingest"],
        waitMinutes: 5,
        verdict: capacityFor(["node:ingest"], []),
      }),
    ).toEqual(
      "no cluster-agent claimed this run (required_tags: [node:ingest]) within 5m — no cluster-agent has ever registered",
    );
  });
});
