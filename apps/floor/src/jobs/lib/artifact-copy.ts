import { Llm } from "@re-cinq/lore-shared";

export interface ArtifactCopyInput {
  kind: "pr" | "issue";
  taskType: string;
  description: string;
  agentOutput?: string;
  changedFiles?: number;
  repo: string;
}

export interface ArtifactCopy {
  title: string;
  body: string;
  source: "llm" | "fallback";
}

/** Injectable LLM call so generateArtifactCopy is unit-testable. */
export type CopyLlm = (params: {
  prompt: string;
  systemPrompt: string;
  toolName: string;
  toolDescription: string;
  toolSchema: Record<string, unknown>;
  jobName: string;
  maxTokens: number;
}) => Promise<{ parsed: { title?: string; body?: string } }>;

const SYSTEM_PROMPT =
  "You write GitHub titles and descriptions that engineers actually open and act on. " +
  "Templated, machine-sounding text gets ignored — write like a thoughtful teammate. " +
  "Title: imperative, specific to the change, under 70 characters, no 'lore:'/'gap-fill:' prefixes, no IDs. " +
  "Body: 2-5 short sentences or bullets — what changed, why it matters, and what the reviewer should check. " +
  "Do not invent details beyond the provided context. Do not include task UUIDs or trailers.";

const MAX_OUTPUT_CHARS = 4000;

/** Build the LLM prompt from the change context. */
export function buildCopyPrompt(input: ArtifactCopyInput): string {
  const artifact = input.kind === "pr" ? "pull request" : "issue";
  const output = (input.agentOutput || "").slice(0, MAX_OUTPUT_CHARS);

  return [
    `Write a title and description for a GitHub ${artifact} in repo ${input.repo}.`,
    `Task type: ${input.taskType}`,
    `Task intent: ${input.description}`,
    input.changedFiles ? `Files changed: ${input.changedFiles}` : "",
    output ? `What the agent reported doing:\n${output}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Deterministic, non-templated copy used when the LLM is unavailable. */
export function fallbackCopy(input: ArtifactCopyInput): ArtifactCopy {
  const firstLine = (input.description || input.taskType).split("\n")[0].trim();
  const title =
    firstLine.length > 70 ? firstLine.slice(0, 69) + "…" : firstLine;
  const filesNote = input.changedFiles
    ? `\n\nChanged files: ${input.changedFiles}`
    : "";
  const body = `${input.description || ""}${filesNote}`.trim();

  return { title, body, source: "fallback" };
}

const defaultLlm: CopyLlm = (params) =>
  Llm.instance.completeWithTool<{ title?: string; body?: string }>(params);

/** Asks the model for an engagement-optimized title + description, falling back to deterministic copy if it errors or returns nothing usable. */
export async function generateArtifactCopy(
  input: ArtifactCopyInput,
  llm: CopyLlm = defaultLlm,
): Promise<ArtifactCopy> {
  try {
    const result = await llm({
      prompt: buildCopyPrompt(input),
      systemPrompt: SYSTEM_PROMPT,
      toolName: "write_copy",
      toolDescription:
        "Provide a title and description for the GitHub artifact",
      toolSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Imperative title, under 70 chars",
          },
          body: { type: "string", description: "Short markdown description" },
        },
        required: ["title", "body"],
      },
      jobName: "artifact-copy",
      maxTokens: 600,
    });

    const title = (result.parsed.title || "").trim();
    const body = (result.parsed.body || "").trim();

    if (title && body) {
      return { title, body, source: "llm" };
    }
  } catch {
    // fall through to deterministic copy
  }

  return fallbackCopy(input);
}
