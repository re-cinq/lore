import { describe, expect, it } from "vitest";
import type { FloorAgents } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { packOverlay, type ShippedCatalog } from "./pack-loader.js";

const SHIPPED_REVIEWER = {
  image: "agent:1",
  timeout_minutes: 30,
  prompt: "Review the diff.",
};

const SHIPPED: ShippedCatalog = {
  pipelines: ["code-review"],
  agents: new Map([
    ["reviewer", SHIPPED_REVIEWER],
    ["merger", { ...SHIPPED_REVIEWER, prompt: "Merge it." }],
  ]) as FloorAgents,
};

const TRIAGE_AGENT =
  "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nTriage.\n";

function pipelineYaml(name: string, agent: string): string {
  return `line:
  id: ${name}
  entry: work
  exit: done
  args:
    repo:
      kind: git
      subject: true
  nodes:
    - id: work
      station: work
      bind:
        target: repo
    - id: done
  edges:
    - from: work
      to: done
      on: success
    - from: work
      to: work
      on: failed
      iteration_max: 1
stations:
  work:
    description: Works the ticket.
    kind: agent
    agent_definition: ${agent}
    conversation: new
    outcomes:
      - success
      - failed
    result_required: true
    needs:
      - name: target
        kind: git
        path: target
    produces: []
`;
}

const ENV = { ACME_IMAGE: "acme/agent:7" };

function overlayOf(files: Record<string, string>) {
  return packOverlay({
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    shipped: SHIPPED,
    env: ENV,
  });
}

describe("packOverlay", () => {
  it("appends an extension file to the shipped prompt of its agent", () => {
    const overlay = overlayOf({
      "code-review/agents/reviewer.extra.md": "Also check our naming rules.",
    });

    expect(overlay.agents).toEqual(
      new Map([
        [
          "reviewer",
          {
            source: "extended",
            settings: {
              ...SHIPPED_REVIEWER,
              prompt: "Review the diff.\n\nAlso check our naming rules.",
            },
          },
        ],
      ]),
    );
  });

  it("replaces a shipped agent wholesale with a full definition of the pack", () => {
    const overlay = overlayOf({
      "code-review/agents/reviewer.md":
        "---\nimage: acme/agent:2\ntimeout_minutes: 10\nmodel: opus\n---\nReview our way.\n",
    });

    expect(overlay.agents.get("reviewer")).toEqual({
      source: "replaced",
      settings: {
        image: "acme/agent:2",
        timeout_minutes: 10,
        model: "opus",
        prompt: "Review our way.\n",
      },
    });
  });

  it("adds an agent nothing ships as pack-new", () => {
    const overlay = overlayOf({
      "triage/agents/triager.md":
        "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nTriage.\n",
    });

    expect(overlay.agents.get("triager")?.source).toEqual("pack-new");
  });

  it("fills the environment into the settings of a pack agent and never into its prompt", () => {
    const overlay = overlayOf({
      "triage/agents/triager.md":
        "---\nimage: ${ACME_IMAGE}\ntimeout_minutes: 10\n---\nRun on ${ACME_IMAGE}.\n",
    });

    expect(overlay.agents.get("triager")?.settings).toEqual({
      image: "acme/agent:7",
      timeout_minutes: 10,
      prompt: "Run on ${ACME_IMAGE}.\n",
    });
  });

  it("refuses an extension of an agent nothing ships and records why", () => {
    const overlay = overlayOf({
      "triage/agents/triager.extra.md": "Be brief.",
    });

    expect({
      agents: [...overlay.agents.keys()],
      refused: overlay.refused,
    }).toEqual({
      agents: [],
      refused: [
        {
          path: "triage/agents/triager.extra.md",
          reason:
            "an extension needs a shipped agent, and nothing ships triager",
        },
      ],
    });
  });

  it("refuses a malformed agent file and still applies the others", () => {
    const overlay = overlayOf({
      "triage/agents/broken.md": "no frontmatter here",
      "triage/agents/triager.md":
        "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nTriage.\n",
    });

    expect({
      agents: [...overlay.agents.keys()],
      refused: overlay.refused,
    }).toEqual({
      agents: ["triager"],
      refused: [
        {
          path: "triage/agents/broken.md",
          reason: "broken.md: missing the --- frontmatter block",
        },
      ],
    });
  });

  it.each([
    ["image", "---\ntimeout_minutes: 10\n---\nTriage.\n"],
    ["timeout_minutes", "---\nimage: acme/agent:2\n---\nTriage.\n"],
    ["prompt", "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\n"],
  ])("refuses a full agent definition without %s", (field, text) => {
    const overlay = overlayOf({ "triage/agents/triager.md": text });

    expect(overlay.refused).toEqual([
      {
        path: "triage/agents/triager.md",
        reason: `triager has no ${field}, and a full agent definition needs a prompt, an image and timeout_minutes`,
      },
    ]);
  });

  it("refuses the extension when the same pack also has the full file of that agent", () => {
    const overlay = overlayOf({
      "code-review/agents/reviewer.md":
        "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nReview our way.\n",
      "code-review/agents/reviewer.extra.md": "More.",
    });

    expect({
      source: overlay.agents.get("reviewer")?.source,
      refused: overlay.refused,
    }).toEqual({
      source: "replaced",
      refused: [
        {
          path: "code-review/agents/reviewer.extra.md",
          reason: "reviewer is already set by code-review/agents/reviewer.md",
        },
      ],
    });
  });

  it("refuses an agent a second folder defines again", () => {
    const text =
      "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nTriage.\n";
    const overlay = overlayOf({
      "b/agents/triager.md": text,
      "a/agents/triager.md": text,
    });

    expect(overlay.refused).toEqual([
      {
        path: "b/agents/triager.md",
        reason: "triager is already set by a/agents/triager.md",
      },
    ]);
  });

  it("refuses an agent file naming an environment variable that is not set", () => {
    const overlay = overlayOf({
      "triage/agents/triager.md":
        "---\nimage: ${MISSING_IMAGE}\ntimeout_minutes: 10\n---\nTriage.\n",
    });

    expect(overlay.refused).toEqual([
      {
        path: "triage/agents/triager.md",
        reason: "MISSING_IMAGE is not set, and a pipeline names it",
      },
    ]);
  });

  it("parses a pipeline folder into a pipeline for the floor named after the folder", () => {
    const overlay = overlayOf({
      "triage/pipeline.yaml": pipelineYaml("triage", "triager"),
      "triage/agents/triager.md": TRIAGE_AGENT,
    });

    expect({
      lines: overlay.pipelines.map((pipeline) => pipeline.line?.id),
      stations: overlay.pipelines.flatMap((pipeline) =>
        pipeline.stations.map((station) => station.id),
      ),
      refused: overlay.refused,
    }).toEqual({ lines: ["triage"], stations: ["work"], refused: [] });
  });

  it("refuses a pipeline folder named like a shipped pipeline", () => {
    const overlay = overlayOf({
      "code-review/pipeline.yaml": pipelineYaml("code-review", "reviewer"),
    });

    expect({
      lines: overlay.pipelines.length,
      refused: overlay.refused,
    }).toEqual({
      lines: 0,
      refused: [
        {
          path: "code-review/pipeline.yaml",
          reason:
            "code-review is a pipeline Lore ships, and a pack cannot replace its shape",
        },
      ],
    });
  });

  it("refuses a pipeline whose line is not named after its folder", () => {
    const overlay = overlayOf({
      "triage/pipeline.yaml": pipelineYaml("sorting", "reviewer"),
    });

    expect(overlay.refused).toEqual([
      {
        path: "triage/pipeline.yaml",
        reason:
          "the folder triage must hold the pipeline of that name, and its line is sorting",
      },
    ]);
  });

  it("refuses a pipeline naming an agent that neither Lore ships nor the pack defines", () => {
    const overlay = overlayOf({
      "triage/pipeline.yaml": pipelineYaml("triage", "ghost"),
    });

    expect(overlay.refused.map((refusal) => refusal.path)).toEqual([
      "triage/pipeline.yaml",
    ]);
  });

  it("refuses a pipeline file that is not a pipeline", () => {
    const overlay = overlayOf({ "triage/pipeline.yaml": "line: [" });

    expect(overlay.refused.map((refusal) => refusal.path)).toEqual([
      "triage/pipeline.yaml",
    ]);
  });

  it("accepts a pipeline naming a shipped agent the pack does not touch, and keeps its agents out of the pipeline", () => {
    const overlay = overlayOf({
      "triage/pipeline.yaml": pipelineYaml("triage", "reviewer"),
    });

    expect({
      lines: overlay.pipelines.map((pipeline) => pipeline.line?.id),
      agentDefinitions: overlay.pipelines.flatMap(
        (pipeline) => pipeline.agentDefinitions,
      ),
      refused: overlay.refused,
    }).toEqual({ lines: ["triage"], agentDefinitions: [], refused: [] });
  });

  it("counts the agents the pack sets, its pipelines and its extensions", () => {
    const overlay = overlayOf({
      "triage/pipeline.yaml": pipelineYaml("triage", "triager"),
      "triage/agents/triager.md": TRIAGE_AGENT,
      "triage/agents/reviewer.extra.md": "More.",
    });

    expect(overlay.counts).toEqual({ agents: 2, pipelines: 1, extensions: 1 });
  });

  it("leaves a shipped agent the pack does not name out of the overlay", () => {
    const overlay = overlayOf({
      "code-review/agents/reviewer.extra.md": "More.",
    });

    expect([...overlay.agents.keys()]).toEqual(["reviewer"]);
  });
});
