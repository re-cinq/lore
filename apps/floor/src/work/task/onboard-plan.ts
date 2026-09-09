/** What onboarding will generate: the standard set the repo lacks, the test-interface scaffold, and a starter ADR set. */

import { errorMessage } from "@re-cinq/lore-shared";
import {
  LORE_TESTS_INSTRUCTION,
  decideTestInterfaceCheck,
} from "@re-cinq/lore-shared";
import { settings } from "../../outbound/queues.js";
import {
  ADR_TOPICS,
  ONBOARD_FILES,
  TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
} from "./onboard-content.js";

/** What the repo already has, which decides what is worth generating. */
export interface OnboardSurvey {
  existingFiles: Set<string>;
  hasAdrs: boolean;
}

/** Unreadable settings are not a reason to fail onboarding; the check just falls back to "not declared". */
async function readSettingsTestCommands(targetRepo: string): Promise<unknown> {
  try {
    const repoSettings = await settings().rawSettings(targetRepo);

    return (repoSettings as { test_commands?: unknown } | null)?.test_commands;
  } catch (err) {
    console.warn(
      `[floor] Onboard: could not read repo settings for test-interface check: ${errorMessage(err)}`,
    );

    return undefined;
  }
}

/** Whether the repo declares a test interface: a manifest file in the tree, or the settings block that overrides it. */
async function testInterfaceCheck(
  targetRepo: string,
  existingFiles: Set<string>,
): Promise<ReturnType<typeof decideTestInterfaceCheck>> {
  return decideTestInterfaceCheck({
    manifestFileDeclared: existingFiles.has(".lore/test-commands.yml"),
    settingsTestCommands: await readSettingsTestCommands(targetRepo),
  });
}

/** Each scaffolded path carries its own generation prompt; the workflow is a different artifact from the manifest. */
function scaffoldPrompt(scaffoldPath: string): string {
  return scaffoldPath === ".github/workflows/lore-tests.yml"
    ? LORE_TESTS_INSTRUCTION
    : TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT;
}

/** Test-interface check (AC12): scaffold manifest + lore-tests.yml for repos without one. */
async function testInterfaceScaffold(
  targetRepo: string,
  existingFiles: Set<string>,
): Promise<{ path: string; prompt: string }[]> {
  const check = await testInterfaceCheck(targetRepo, existingFiles);

  if (check.status === "configured") {
    console.log(
      "[floor] Onboard: test interface already configured — scaffolding nothing",
    );

    return [];
  }

  const missing = check.files.filter(
    (scaffoldPath) => !existingFiles.has(scaffoldPath),
  );

  return missing.map((scaffoldPath) => ({
    path: scaffoldPath,
    prompt: scaffoldPrompt(scaffoldPath),
  }));
}

/** The starter ADR set, numbered from 1, for a repo with no decision record yet. */
function starterAdrs(): { path: string; prompt: string }[] {
  const [today] = new Date().toISOString().split("T");

  return ADR_TOPICS.map((adr, index) => {
    const adrNum = index + 1;

    return {
      path: `adrs/ADR-${String(adrNum).padStart(3, "0")}-${adr.slug}.md`,
      prompt:
        adr.prompt +
        ` Use MADR format with YAML frontmatter (adr_number: ${adrNum}, title, status: accepted, date: ${today}, domains: [...]).`,
    };
  });
}

/** The standard onboarding set the repo does not already carry, matched by full path or by bare filename. */
function missingStandardFiles(
  existingFiles: Set<string>,
): { path: string; prompt: string }[] {
  const toGenerate: { path: string; prompt: string }[] = [];

  for (const f of ONBOARD_FILES) {
    const present =
      existingFiles.has(f.path) || existingFiles.has(basename(f.path));

    if (present) {
      console.log(`[floor] Onboard: skipping ${f.path} (already exists)`);
      continue;
    }
    toGenerate.push({ path: f.path, prompt: f.prompt });
  }

  return toGenerate;
}

/** The files this onboarding will generate: the standard set the repo lacks, the test-interface scaffold when it declares no manifest, and a starter ADR set when it has no adrs/ or docs/ yet. */
export async function planOnboardFiles(
  targetRepo: string,
  { existingFiles, hasAdrs }: OnboardSurvey,
): Promise<{ path: string; prompt: string }[]> {
  const toGenerate = missingStandardFiles(existingFiles);

  toGenerate.push(...(await testInterfaceScaffold(targetRepo, existingFiles)));

  if (hasAdrs) {
    console.log(
      `[floor] Onboard: skipping ADRs (adrs/ or docs/ already exists)`,
    );

    return toGenerate;
  }
  toGenerate.push(...starterAdrs());

  return toGenerate;
}

/** Last path segment; a repo that keeps a standard file at its root still counts as having it. */
function basename(path: string): string {
  const segments = path.split("/");

  return segments[segments.length - 1];
}
