// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface CiFailedCheck {
  name: string;
  failed_step?: string;
  step_log?: string;
  npm_script?: { package: string; script: string };
}

export interface CiVerdict {
  judged_sha: string;
  failed_checks: CiFailedCheck[];
}

// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface RuntimeContextArgs {
  reported_changes?: boolean;
  previous_round_report?: { done?: string; next?: string };
  ci_verdict?: CiVerdict;
  node_failure?: { name: string; output: string };
  [key: string]: unknown;
}

/** Appends node-failure (when not reported_changes) or previous-round and CI-verdict blocks (when reported_changes has failed_checks). */
export function appendRuntimeContext(
  basePrompt: string,
  args: RuntimeContextArgs,
): string {
  const blocks = buildContextBlocks(args);

  if (blocks.length === 0) {
    return basePrompt;
  }

  return [basePrompt, ...blocks].join("\n\n");
}

function buildContextBlocks(args: RuntimeContextArgs): string[] {
  if (!args.reported_changes) {
    return args.node_failure ? [buildNodeFailureBlock(args.node_failure)] : [];
  }

  return buildCiVerdictBlocks(args);
}

function buildNodeFailureBlock(failure: {
  name: string;
  output: string;
}): string {
  return [`## The previous step ${failure.name} failed`, failure.output].join(
    "\n",
  );
}

function buildCiVerdictBlocks(args: RuntimeContextArgs): string[] {
  const { previous_round_report, ci_verdict } = args;

  if (!ci_verdict || ci_verdict.failed_checks.length === 0) {
    return [];
  }
  const blocks: string[] = [];

  if (previous_round_report) {
    blocks.push(buildPreviousRoundBlock(previous_round_report));
  }
  blocks.push(buildCiBlock(ci_verdict));

  return blocks;
}

function buildPreviousRoundBlock(report: {
  done?: string;
  next?: string;
}): string {
  const lines = ["## The previous round reported"];

  if (report.done) {
    lines.push(`Done: ${report.done}`);
  }

  if (report.next) {
    lines.push(`Next: ${report.next}`);
  }

  return lines.join("\n");
}

function buildCiBlock(verdict: CiVerdict): string {
  const lines = [`## CI reported failures on ${verdict.judged_sha}`];

  for (const check of verdict.failed_checks) {
    lines.push(...buildCheckLines(check));

    if (check.step_log) {
      lines.push("```", check.step_log, "```");
    }

    if (check.npm_script) {
      lines.push(
        `  Ran as: npm script ${check.npm_script.script} of package ${check.npm_script.package}`,
      );
    }
  }

  return lines.join("\n");
}

function buildCheckLines(check: CiFailedCheck): string[] {
  if (check.failed_step) {
    return [
      `- **${check.name}**: run only a failed step's command: \`${check.failed_step}\``,
    ];
  }

  return [`- **${check.name}**: a job's whole command`];
}

/** What every agent run is told about its own context: fills the recipe's `{context}` slot with an instruction (not the fetched context itself — that needed a central-only credential, so every run now opens cold and identically regardless of cluster). */
export const CONTEXT_BOOTSTRAP =
  "First step: nothing is pre-loaded for this run — call the Lore MCP server's " +
  "`lore_assemble_context` tool, then `lore_search_memory` for past learnings, before " +
  "you change anything. Pass `repo` (the owner/name above) on every call: the shared " +
  "server has no checkout to detect it from. Query with what the work is ABOUT — the " +
  "title, the feature, the spec sections and the surfaces it touches — not the words " +
  "of this instruction, or you get the platform overview back. Your CLI may list the " +
  "tools under the server's prefix. The `lore_*` tools stay live for the whole run.";

const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g;

/** What the pod's model actually receives: the subsystem's `renderPrompt` rule (plain `{name}` substitution from the Agent CR's parameters, an unmatched placeholder left literal). Kept here so a Floor-side test can assert on the POD's view of a dispatch, not only on the string the Floor sent — #2051 hid for weeks because every test read the parameter nothing rendered. */
export function renderPodPrompt(
  template: string,
  parameters: Readonly<Record<string, string>>,
): string {
  return template.replace(PLACEHOLDER, (token, name: string) =>
    name in parameters ? parameters[name] : token,
  );
}
