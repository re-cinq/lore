import { query } from "../../db.js";
import { callLLMWithTool } from "../../anthropic.js";
import { isAssertionSource, shouldSkipDrift } from "./spec-drift-rules.js";

interface SpecChunk {
  id: string;
  repo: string;
  file_path: string;
  content: string;
}

interface CodeChunk {
  symbol_name: string;
  symbol_type: string;
  file_path: string;
}

interface Assertion {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "endpoint" | "other";
  description: string;
}

const DIVERGENCE_THRESHOLD = 0.2; // 20%

/** Look-back window for "has this repo shipped anything?". */
const ACTIVITY_WINDOW_DAYS = 7;

/**
 * Spec Drift Detection Job
 *
 * Runs weekly. For each spec in the chunk store:
 * 1. Extract testable assertions via LLM (function names, endpoints, data structures)
 * 2. Match against code chunks using symbol_name metadata from AST chunking
 * 3. If divergence > 20%, create a gap-fill pipeline task
 *
 * Activity pre-filter (added 2026-04-17): skip specs in repos whose
 * code hasn't been re-ingested in the last ACTIVITY_WINDOW_DAYS days.
 * If a repo ships nothing, its code can't have drifted from its spec —
 * scanning it is pure LLM waste. The push-triggered lore-ingest.yml
 * workflow refreshes chunks.ingested_at on every merge to main, so
 * recent code-chunk activity is a reliable "something shipped" signal.
 */
export async function specDriftJob(): Promise<string> {
  // Get all spec chunks
  const specs = await query<SpecChunk>(
    `SELECT id, repo, file_path, content
     FROM org_shared.chunks
     WHERE content_type = 'spec'
     ORDER BY repo, file_path`,
  );

  if (specs.length === 0) {
    console.log("[job] spec-drift: no specs found in chunks");
    return "No specs found";
  }

  // Pre-filter: which repos have had code chunk updates in the window?
  const activeRepoRows = await query<{ repo: string }>(
    `SELECT DISTINCT repo
     FROM org_shared.chunks
     WHERE content_type = 'code'
       AND ingested_at > now() - ($1 || ' days')::interval`,
    [String(ACTIVITY_WINDOW_DAYS)],
  );
  const activeRepos = new Set(activeRepoRows.map((r) => r.repo));

  // Group specs by repo
  const byRepo = new Map<string, SpecChunk[]>();
  for (const spec of specs) {
    const list = byRepo.get(spec.repo) || [];
    list.push(spec);
    byRepo.set(spec.repo, list);
  }

  let totalChecked = 0;
  let totalDrift = 0;
  let skippedRepos = 0;
  let skippedSpecs = 0;
  let filteredDocs = 0;

  for (const [repo, repoSpecs] of byRepo) {
    if (!activeRepos.has(repo)) {
      skippedRepos++;
      skippedSpecs += repoSpecs.length;
      console.log(
        `[job] spec-drift: skipping ${repo} — no code chunk updates in last ${ACTIVITY_WINDOW_DAYS}d (${repoSpecs.length} specs skipped)`,
      );
      continue;
    }
    // Get all code chunks for this repo with symbol metadata
    const codeChunks = await query<CodeChunk>(
      `SELECT
         metadata->>'symbol_name' AS symbol_name,
         metadata->>'symbol_type' AS symbol_type,
         file_path
       FROM org_shared.chunks
       WHERE repo = $1
         AND content_type = 'code'
         AND metadata->>'symbol_name' IS NOT NULL`,
      [repo],
    );

    // Build a set of known symbols for fast lookup
    const knownSymbols = new Set(
      codeChunks.map((c) => c.symbol_name.toLowerCase()),
    );

    for (const spec of repoSpecs) {
      // Skip prose artifacts (research/plan/tasks/quickstart) — they name
      // concepts, not code symbols, so they always read as 100% drifted.
      if (!isAssertionSource(spec.file_path)) {
        filteredDocs++;
        console.log(
          `[job] spec-drift: skipping ${repo}:${spec.file_path} — prose doc, not an assertion source`,
        );
        continue;
      }
      try {
        // Extract assertions from spec via LLM
        const assertions = await extractAssertions(spec.content, spec.file_path);

        if (assertions.length === 0) {
          console.log(
            `[job] spec-drift: ${repo}:${spec.file_path} — no assertions extracted`,
          );
          continue;
        }

        // Check which assertions are satisfied
        const missing: Assertion[] = [];
        for (const a of assertions) {
          if (!knownSymbols.has(a.name.toLowerCase())) {
            missing.push(a);
          }
        }

        const divergence = missing.length / assertions.length;
        totalChecked++;

        console.log(
          `[job] spec-drift: ${repo}:${spec.file_path} — ${assertions.length} assertions, ${missing.length} missing (${(divergence * 100).toFixed(0)}%)`,
        );

        if (divergence > DIVERGENCE_THRESHOLD && missing.length > 0) {
          totalDrift++;
          await createDriftTask(repo, spec.file_path, assertions, missing, divergence);
        }
      } catch (err) {
        console.error(
          `[job] spec-drift: error processing ${repo}:${spec.file_path}:`,
          err,
        );
      }
    }
  }

  const activeRepoCount = byRepo.size - skippedRepos;
  const summary = `Checked ${totalChecked} specs across ${activeRepoCount} active repos (${totalDrift} drifted); skipped ${skippedSpecs} specs from ${skippedRepos} quiet repos, ${filteredDocs} prose docs`;
  console.log(`[job] spec-drift: ${summary}`);
  return summary;
}

async function extractAssertions(
  specContent: string,
  filePath: string,
): Promise<Assertion[]> {
  // Truncate spec content to avoid token limits
  const truncated = specContent.substring(0, 12000);

  const result = await callLLMWithTool<{ assertions: Assertion[] }>({
    prompt: `Analyze this specification and extract testable assertions — concrete names of functions, classes, interfaces, types, or API endpoints that SHOULD exist in the codebase based on this spec.

Only extract items that are explicitly named in the spec. Do not infer or guess.

Spec file: ${filePath}
---
${truncated}`,
    systemPrompt:
      "You extract testable code assertions from specifications. Return only explicitly named items.",
    toolName: "extract_assertions",
    toolDescription: "Extract testable assertions from a spec",
    toolSchema: {
      type: "object",
      properties: {
        assertions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The exact name of the function, class, type, or endpoint",
              },
              kind: {
                type: "string",
                enum: ["function", "class", "interface", "type", "endpoint", "other"],
              },
              description: {
                type: "string",
                description: "What this assertion checks for",
              },
            },
            required: ["name", "kind", "description"],
          },
        },
      },
      required: ["assertions"],
    },
    jobName: "spec_drift",
  });

  return result.data.assertions || [];
}

async function createDriftTask(
  repo: string,
  specPath: string,
  allAssertions: Assertion[],
  missing: Assertion[],
  divergence: number,
): Promise<void> {
  const missingList = missing
    .map((a) => `- ${a.kind}: \`${a.name}\` — ${a.description}`)
    .join("\n");

  // Skip if a drift task for this spec is still open, or a resolved one is
  // within the cooldown — otherwise the weekly cron files a duplicate PR every
  // run for specs already sitting in review.
  const existing = await query<{ status: string; created_at: string }>(
    `SELECT status, created_at FROM pipeline.tasks
     WHERE target_repo = $1
       AND task_type = 'gap-fill'
       AND description LIKE $2`,
    [repo, `Spec drift: ${specPath}%`],
  );

  if (shouldSkipDrift(existing, new Date())) {
    console.log(
      `[job] spec-drift: skipping ${repo}:${specPath} — ${existing.length} existing task(s), still open or within cooldown`,
    );
    return;
  }

  const title = `Spec drift: ${specPath} (${(divergence * 100).toFixed(0)}% divergence)`;
  const description = `Spec file \`${specPath}\` in \`${repo}\` has ${(divergence * 100).toFixed(0)}% divergence from the codebase.

**${allAssertions.length} assertions checked, ${missing.length} missing:**

${missingList}

Either update the spec to reflect current code, or implement the missing items.`;

  await query(
    `INSERT INTO pipeline.tasks (description, task_type, status, target_repo, context_bundle)
     VALUES ($1, 'gap-fill', 'pending', $2, $3)`,
    [
      title,
      repo,
      JSON.stringify({ spec_path: specPath, missing_count: missing.length, divergence, details: description }),
    ],
  );

  console.log(
    `[job] spec-drift: created gap-fill task for ${repo}:${specPath}`,
  );
}
