import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { shippedAgentPrompts } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { pipelineProblems } from "./pipeline-lint.js";

interface Edge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

interface ReleasePipeline {
  line: {
    id: string;
    entry: string;
    exit: string;
    fail: string;
    args: Record<string, { kind: string; subject?: boolean }>;
    nodes: Array<{ id: string; station?: string }>;
    edges: Edge[];
  };
  stations: Record<
    string,
    {
      kind: string;
      description?: string;
      agent_definition?: string;
      conversation?: string;
      needs: Array<{ name: string; kind: string; path?: string }>;
      produces: Array<{ name: string; kind: string; path?: string }>;
    }
  >;
}

const YAML_TEXT = readFileSync(
  new URL("./floor-pipelines/release.yaml", import.meta.url),
  "utf8",
);
const { line, stations } = parse(YAML_TEXT) as ReleasePipeline;

const edgeOf = (from: string, on: string): Edge | undefined =>
  line.edges.find((edge) => edge.from === from && edge.on === on);

describe("the release pipeline file", () => {
  it("passes pipelineProblems with the shipped agent prompts", () => {
    expect(pipelineProblems(YAML_TEXT, shippedAgentPrompts())).toEqual([]);
  });

  it("names only the stations it declares, and release-notes as its one agent", () => {
    const declared = line.nodes.flatMap((node) => node.station ?? []);

    expect({
      undeclared: declared.filter((station) => !(station in stations)),
      agents: Object.values(stations).flatMap(
        (station) => station.agent_definition ?? [],
      ),
      prompt: typeof shippedAgentPrompts().get("release-notes"),
    }).toEqual({
      undeclared: [],
      agents: ["release-notes"],
      prompt: "string",
    });
  });

  it("walks collect, write, tag, publish, github-release, store and announce to done on success, keyed on release_key", () => {
    const forward = line.edges
      .filter((edge) => edge.on === "success")
      .map((edge) => `${edge.from}>${edge.to}`);

    expect({
      id: line.id,
      entry: line.entry,
      forward,
      subject: line.args["release_key"],
      repo: line.args["release_repo"],
    }).toEqual({
      id: "release",
      entry: "collect",
      forward: [
        "collect>write",
        "write>tag",
        "tag>publish",
        "publish>github-release",
        "github-release>store",
        "store>announce",
        "announce>done",
      ],
      subject: { kind: "value", subject: true },
      repo: { kind: "value" },
    });
  });

  it("ends a collect that found nothing as empty at done without writing", () => {
    expect(edgeOf("collect", "empty")).toEqual({
      from: "collect",
      to: "done",
      on: "empty",
    });
  });

  it("retries collect, write, tag, github-release, store and announce once on failed", () => {
    const retries = [
      "collect",
      "write",
      "tag",
      "github-release",
      "store",
      "announce",
    ].map((node) => edgeOf(node, "failed"));

    expect(retries).toEqual(
      ["collect", "write", "tag", "github-release", "store", "announce"].map(
        (node) => ({ from: node, to: node, on: "failed", iteration_max: 1 }),
      ),
    );
  });

  it("sends tag back to write once on changes_requested", () => {
    expect(edgeOf("tag", "changes_requested")).toEqual({
      from: "tag",
      to: "write",
      on: "changes_requested",
      iteration_max: 1,
    });
  });

  it("fails the run when publish fails, with no edge from publish back to itself or to an earlier node", () => {
    const leaving = line.edges.filter((edge) => edge.from === "publish");

    expect({ fail: line.fail, leaving }).toEqual({
      fail: "failed",
      leaving: [
        { from: "publish", to: "github-release", on: "success" },
        { from: "publish", to: "failed", on: "failed" },
      ],
    });
  });

  it("makes the agent station read release_changes and write release.md as release_notes and bump.json as release_bump", () => {
    expect(stations["release-write"]).toMatchObject({
      kind: "agent",
      conversation: "new",
      needs: [{ name: "release_changes", kind: "file" }],
      produces: [
        { name: "release_notes", kind: "file", path: "release.md" },
        { name: "release_bump", kind: "file", path: "bump.json" },
      ],
    });
  });

  it("gives every station a description", () => {
    expect(
      Object.entries(stations)
        .filter(([, station]) => !station.description)
        .map(([name]) => name),
    ).toEqual([]);
  });
});
