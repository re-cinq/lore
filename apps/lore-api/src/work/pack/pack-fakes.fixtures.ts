import type { Pipeline, Put } from "@re-cinq/floor-pipeline";
import type {
  FloorAgents,
  FloorAgentSettings,
} from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import type { PackSyncState } from "@re-cinq/lore-shared";
import type { LeaseBackend } from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import type { PackDeps } from "./apply-pack.js";
import type { PackFile } from "./fetch-pack.js";

export const SHIPPED_REVIEWER: FloorAgentSettings = {
  image: "agent:1",
  timeout_minutes: 30,
  prompt: "Review the diff.",
};

export const TRIAGE_AGENT_TEXT =
  "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nTriage.\n";

export const TRIAGE_PIPELINE_TEXT = `line:
  id: triage
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
    agent_definition: triager
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

export const EXTENSION: PackFile = {
  path: "code-review/agents/reviewer.extra.md",
  text: "Check our naming rules.",
};

export const EXTENDED_REVIEWER: FloorAgentSettings = {
  ...SHIPPED_REVIEWER,
  prompt: "Review the diff.\n\nCheck our naming rules.",
};

export interface FakePack {
  commit: string;
  files: PackFile[];
  unreachable: Error | null;
  floorFailure: Error | null;
  floorAgents: Map<string, FloorAgentSettings>;
  floorPipelines: Set<string>;
  archived: string[];
  agentPuts: string[];
  sync: PackSyncState | null;
  deps(): PackDeps;
}

/** An in-memory floor, settings store and pack repository: the behavioural spec of the ports an apply is given. */
export function fakePack(): FakePack {
  const pack: FakePack = {
    commit: "c0ffee1",
    files: [],
    unreachable: null,
    floorFailure: null,
    floorAgents: new Map(),
    floorPipelines: new Set(),
    archived: [],
    agentPuts: [],
    sync: null,
    deps: () => depsOf(pack),
  };

  return pack;
}

function depsOf(pack: FakePack): PackDeps {
  return {
    config: { repo: "acme/pack", ref: "main" },
    env: {},
    now: () => new Date("2026-11-17T10:00:00.000Z"),
    fetch: async () => {
      if (pack.unreachable) {
        throw pack.unreachable;
      }

      return { commit: pack.commit, files: pack.files };
    },
    shipped: async () => ({
      pipelines: ["code-review"],
      agents: new Map([["reviewer", SHIPPED_REVIEWER]]) as FloorAgents,
    }),
    ...agentPortsOf(pack),
    ...pipelinePortsOf(pack),
    ...syncPortsOf(pack),
  };
}

function syncPortsOf(pack: FakePack): Pick<PackDeps, "readSync" | "writeSync"> {
  return {
    readSync: async () => pack.sync,
    writeSync: async (state) => {
      pack.sync = state;
    },
  };
}

function agentPortsOf(
  pack: FakePack,
): Pick<PackDeps, "floorAgent" | "putAgent"> {
  return {
    floorAgent: async (name) => pack.floorAgents.get(name) ?? null,
    putAgent: async (name, settings) => {
      if (pack.floorFailure) {
        throw pack.floorFailure;
      }
      pack.agentPuts.push(name);
      pack.floorAgents.set(name, settings);
    },
  };
}

function pipelinePortsOf(
  pack: FakePack,
): Pick<PackDeps, "importPipeline" | "archivePipeline"> {
  return {
    importPipeline: async (pipeline: Pipeline): Promise<Put[]> => {
      const id = pipeline.line?.id ?? "";
      const changed = !pack.floorPipelines.has(id);

      pack.floorPipelines.add(id);

      return [{ kind: "assembly-lines", id, changed }];
    },
    archivePipeline: async (name) => {
      pack.floorPipelines.delete(name);
      pack.archived.push(name);
    },
  };
}

export interface FakeLeases extends LeaseBackend {
  held: Map<string, string>;
}

/** An in-memory lease table: the behavioural spec of the LeaseBackend a sync takes its lease from. */
export function fakeLeases(): FakeLeases {
  const held = new Map<string, string>();

  return {
    held,
    acquire: async (branchName, _taskId, holder) => {
      const currentHolder = held.get(branchName);

      if (currentHolder !== undefined) {
        return { acquired: false, currentHolder };
      }
      held.set(branchName, holder);

      return { acquired: true };
    },
    refresh: async () => true,
    release: async (branchName, holder) =>
      held.get(branchName) === holder && held.delete(branchName),
    reapExpired: async () => [],
  };
}
