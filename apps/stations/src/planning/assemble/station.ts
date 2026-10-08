// Joins the pods of a round: each wrote a patch for its own section, and this applies them in the order the sections were handed, commits the spec once, and settles what the pods returned. A section whose patch is missing, or one of whose operations did not apply, asks for another round (see specs/7-feature-planning/spec.md FR-24).

import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { specPathsOfPlan } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import {
  alignPatches,
  applyPatches,
  emptySectionState,
  sectionPatchSchema,
  settleRound,
  type SectionPatch,
  type SectionState,
} from "@re-cinq/lore-shared/feature-planning/spec-sections.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface AssembleDeps {
  /** A spec file as it stands at a branch; null when there is no such file. */
  readSpec(repo: string, path: string, ref: string): Promise<string | null>;
  commitSpec(
    repo: string,
    branch: string,
    file: { path: string; text: string },
    message: string,
  ): Promise<void>;
}

export const assembleDeps: AssembleDeps = {
  readSpec: async (repo, path, ref) =>
    (await projectFor(repo)).repo.read(path, ref),
  commitSpec: async (repo, branch, { path, text }, message) =>
    (await projectFor(repo)).repo.commitFile(branch, path, text, message),
};

export function assembleHandle(deps: AssembleDeps): Handle {
  return async (brief, tools) => {
    try {
      return await assembled(deps, brief, tools);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function assembled(
  deps: AssembleDeps,
  brief: Brief,
  tools: Tools,
): Promise<Report> {
  const round = await readRound(deps, brief, tools);
  const patches = alignPatches(round.state.handed, patchesOf(brief));
  const applied = applyPatches(
    round.before,
    present(patches),
    round.defaultFile,
  );
  const settled = settleRound(round.state, patches, applied.failedOps);
  const changes = { before: round.before, after: applied.files };

  await commitChanged(deps, round.location, changes, patches);
  await tools.produce("section_state", JSON.stringify(settled.state));

  return { outcome: settled.retry ? "retry" : "success" };
}

interface Round {
  location: Branch;
  state: SectionState;
  /** The spec files the plan names that the branch holds. */
  before: Record<string, string>;
  defaultFile: string;
}

async function readRound(
  deps: AssembleDeps,
  brief: Brief,
  tools: Tools,
): Promise<Round> {
  const location = parseGitRef(brief.needs.target);
  const paths = specPathsOfPlan(
    (await tools.read("spec_plan")).toString("utf8"),
  );

  return {
    location,
    state: await stateOf(tools),
    before: await specFiles(deps, location, paths),
    defaultFile: paths[0] ?? "",
  };
}

async function stateOf(tools: Tools): Promise<SectionState> {
  const text = (await tools.read("section_state")).toString("utf8");

  return text === "" ? emptySectionState() : (JSON.parse(text) as SectionState);
}

interface Branch {
  repo: string;
  branch: string;
}

/** The spec files the plan names that the branch holds, by path. */
async function specFiles(
  deps: AssembleDeps,
  { repo, branch }: Branch,
  paths: readonly string[],
): Promise<Record<string, string>> {
  const read = await Promise.all(
    paths.map(
      async (path) => [path, await deps.readSpec(repo, path, branch)] as const,
    ),
  );

  return Object.fromEntries(
    read.filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

/** What each pod returned, as the collected texts the join was handed; a text that is not a patch is no patch. */
function patchesOf(brief: Brief): SectionPatch[] {
  const texts = parsedArray(brief.needs.section_patches);

  return texts.flatMap((text) => {
    const patch = sectionPatchSchema.safeParse(parsedJson(String(text)));

    return patch.success ? [patch.data] : [];
  });
}

function parsedArray(text: string | undefined): unknown[] {
  const parsed = parsedJson(text ?? "[]");

  return Array.isArray(parsed) ? parsed : [];
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function present(patches: readonly (SectionPatch | null)[]): SectionPatch[] {
  return patches.filter((patch): patch is SectionPatch => patch !== null);
}

async function commitChanged(
  deps: AssembleDeps,
  { repo, branch }: Branch,
  {
    before,
    after,
  }: { before: Record<string, string>; after: Record<string, string> },
  patches: readonly (SectionPatch | null)[],
): Promise<void> {
  const sections = present(patches).map((patch) => patch.section);
  const message = `Fold plan sections into the spec: ${sections.join(", ")}`;
  const changed = Object.keys(after).filter(
    (path) => after[path] !== before[path],
  );

  for (const path of changed) {
    await deps.commitSpec(repo, branch, { path, text: after[path]! }, message);
  }
}

export function startAssembleStation(): RunningStation {
  return defineStation("assemble", assembleHandle(assembleDeps));
}
