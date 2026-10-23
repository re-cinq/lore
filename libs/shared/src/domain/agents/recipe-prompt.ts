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

export interface RuntimeContextArgs {
  reported_changes?: boolean;
  previous_round_report?: { done?: string; next?: string };
  ci_verdict?: CiVerdict;
  [key: string]: unknown;
}

/** Appends CI verdict and previous-round report blocks to the base prompt.
 * Renders only when reported_changes is true AND ci_verdict names at least one failed check.
 * The previous-round block (if any) precedes the CI block, which always stays last. */
export function appendRuntimeContext(
  basePrompt: string,
  args: RuntimeContextArgs,
): string {
  const { reported_changes, previous_round_report, ci_verdict } = args;

  if (
    !reported_changes ||
    !ci_verdict ||
    ci_verdict.failed_checks.length === 0
  ) {
    return basePrompt;
  }

  const blocks: string[] = [basePrompt];

  if (previous_round_report) {
    const lines = ["## The previous round reported"];
    if (previous_round_report.done)
      lines.push(`Done: ${previous_round_report.done}`);
    if (previous_round_report.next)
      lines.push(`Next: ${previous_round_report.next}`);
    blocks.push(lines.join("\n"));
  }

  const ciLines: string[] = [
    `## CI reported failures on ${ci_verdict.judged_sha}`,
  ];
  for (const check of ci_verdict.failed_checks) {
    if (check.failed_step) {
      ciLines.push(
        `- **${check.name}**: run only a failed step's command: \`${check.failed_step}\``,
      );
    } else {
      ciLines.push(`- **${check.name}**: a job's whole command`);
    }
    if (check.step_log) {
      ciLines.push("```");
      ciLines.push(check.step_log);
      ciLines.push("```");
    }
    if (check.npm_script) {
      ciLines.push(
        `  Ran as: npm script ${check.npm_script.script} of package ${check.npm_script.package}`,
      );
    }
  }
  blocks.push(ciLines.join("\n"));

  return blocks.join("\n\n");
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
