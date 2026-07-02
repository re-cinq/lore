/**
 * Feature request handler.
 *
 * Translates a PM's plain-language intent into a proper spec, data model,
 * and task breakdown — following the target repo's conventions.
 */

import { query } from "../../kernel/db.js";
import { Llm } from "@re-cinq/lore-shared";
import { projectFor } from "../../composition/project-boot.js";
import { fetchRepoContext } from "./repo-context.js";
import { writeEpisode } from "../lib/episode-writer.js";
import { slugify, setStatus, insertEvent, issueRef, linkPrToIssue } from "./task-helpers.js";

// ── Feature request handler ───────────────────────────────────────────

/**
 * Translates a PM's plain-language intent into a proper spec, data model,
 * and task breakdown — following the target repo's conventions.
 *
 * 1. Pre-fetches repo context (CLAUDE.md, existing specs, ADRs)
 * 2. Generates spec.md matching the repo's spec format
 * 3. Generates data-model.md if the feature involves data
 * 4. Generates an initial tasks.md breakdown
 * 5. Opens a PR with all artifacts for engineer review
 */
export async function handleFeatureRequest(
  task: any,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  issueNumber: number | null,
): Promise<void> {
  const project = await projectFor(targetRepo);
  console.log(`[floor] Feature request: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);
  const contextStr = JSON.stringify(context, null, 2);

  // Also fetch existing specs as examples for format matching
  let existingSpecExample = "";
  try {
    const specs = await query(
      `SELECT content FROM org_shared.chunks WHERE repo = $1 AND content_type = 'spec' LIMIT 1`,
      [targetRepo],
    );
    if (specs.length > 0) {
      existingSpecExample = `\n\n## Existing Spec Example (match this format)\n\n${(specs[0] as any).content.substring(0, 3000)}`;
    }
  } catch { /* no specs in DB yet, that's fine */ }

  const pmIntent = task.description;
  const featureSlug = slugify(pmIntent);

  const SPEC_FILES = [
    {
      path: `specs/${featureSlug}/spec.md`,
      prompt: `Write a feature specification for the following product request.

The PM said: "${pmIntent}"

Write a proper engineering spec with these sections:
- Problem Statement (what problem does this solve for users?)
- Vision (what does the end state look like?)
- User Scenarios & Acceptance Criteria (concrete flows with testable criteria)
- Functional Requirements (numbered, testable)
- Non-Functional Requirements (performance, security if relevant)
- Out of Scope (what this does NOT include)
- Key Entities (data model implications)
- Success Criteria (measurable outcomes)
- Assumptions

Match the conventions and style of this repository. Be specific to the actual tech stack and architecture described in CLAUDE.md.${existingSpecExample}`,
    },
    {
      path: `specs/${featureSlug}/data-model.md`,
      prompt: `Based on this feature request, define the data model changes needed.

The PM said: "${pmIntent}"

If the feature requires new tables, fields, or relationships, document them with:
- Table name, fields, types, constraints
- Relationships to existing entities
- Migration notes

If no data model changes are needed, respond with just "SKIP".

Look at the existing schema in CLAUDE.md and any existing data models for conventions.`,
    },
    {
      path: `specs/${featureSlug}/tasks.md`,
      prompt: `Create a task breakdown for implementing this feature.

The PM said: "${pmIntent}"

Generate tasks in checklist format:
- [ ] T001 [P] Description with file path
- [ ] T002 Description with file path

Organize into phases:
- Phase 1: Setup (project scaffolding, dependencies)
- Phase 2: Core (main implementation)
- Phase 3: Integration (wiring, testing, polish)

Mark parallelizable tasks with [P]. Include file paths based on the actual project structure visible in the repo context. Each task must be specific enough for an engineer (or AI agent) to execute without additional context.`,
    },
  ];

  console.log(`[floor] Feature request: generating ${SPEC_FILES.length} artifacts for "${featureSlug}"...`);

  await project.repo.createBranch(branchName);

  const committed: string[] = [];
  for (const file of SPEC_FILES) {
    try {
      const result = await Llm.instance.complete({
        prompt: `${file.prompt}\n\n## Repository Context\n\n${contextStr}`,
        systemPrompt: `Generate the content for ${file.path}. Output ONLY the file content — no explanation, no markdown code fences, no preamble. Start directly with the file content.`,
        model,
        maxTokens: 8192,
        taskId: task.id,
      });

      const text = result.text.trim();
      if (text === "SKIP" || text.length < 20) {
        console.log(`[floor] Feature request: skipping ${file.path} (not needed)`);
        continue;
      }

      await project.repo.commitFile(branchName, file.path, text, `lore: add ${file.path}`);
      committed.push(file.path);
      console.log(`[floor] Feature request: committed ${file.path} (${text.length} chars)`);
    } catch (err: any) {
      console.error(`[floor] Feature request: failed ${file.path}: ${err.message}`);
    }
  }

  if (committed.length === 0) {
    throw new Error("Failed to generate any spec artifacts");
  }

  const fileList = committed.map((f) => `- \`${f}\``).join("\n");
  const pr = await project.pulls.open(
    branchName,
    `spec: ${featureSlug}`,
    `## Feature Request → Spec\n\n**PM intent:** ${pmIntent}\n\n**Generated artifacts:**\n${fileList}\n\nThis spec was generated from a plain-language feature request. Engineers should review, refine, and merge before implementation.\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber, task.id)}`,
    "main",
    ["spec", "needs-review"],
  );
  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });

  // Auto-capture feature-request as episode
  writeEpisode(
    `Feature request spec generated for ${targetRepo}\nPM intent: ${pmIntent.substring(0, 300)}\nArtifacts: ${committed.join(", ")}\nPR: ${pr.url}`,
    "ci",
    `${targetRepo}/${task.id}`,
  ).catch(() => {});

  console.log(`[floor] Task ${task.id} → PR ${pr.url} (${committed.length} spec artifacts)`);
}
