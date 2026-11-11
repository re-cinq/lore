import { Llm } from "../outbound/llm/llm.js";
import type { LlmProvider } from "../outbound/llm/llm-provider.js";

export interface CopyResult {
  title: string;
  body: string;
  source: "llm" | "fallback";
}

export interface BuildCopyPromptArgs {
  kind: string;
  repo: string;
  taskIntent: string;
  agentOutput?: string;
  files?: string[];
}

export function buildCopyPrompt(args: BuildCopyPromptArgs): string {
  const lines = [
    `Kind: ${args.kind}`,
    `Repo: ${args.repo}`,
    `Task intent: ${args.taskIntent}`,
  ];

  if (args.agentOutput) {
    lines.push(`Agent output: ${args.agentOutput}`);
  }

  if (args.files !== undefined && args.files.length > 0) {
    lines.push(`Changed files: ${args.files.join(", ")}`);
  }

  return lines.join("\n");
}

export interface FallbackCopyArgs {
  description: string;
  taskType: string;
  changedFiles: string[];
}

export function fallbackCopy(args: FallbackCopyArgs): CopyResult {
  const title = deriveTitle(args.description, args.taskType);
  const filesNote =
    args.changedFiles.length > 0
      ? `\n\nChanged files:\n${args.changedFiles.join("\n")}`
      : "";
  const body = `${args.description}${filesNote}`.trim();

  return { title, body, source: "fallback" };
}

function deriveTitle(description: string, taskType: string): string {
  const parts = description.split("\n");
  const first = parts[0].trim();

  if (!first) {
    return taskType;
  }

  if (first.length > 70) {
    return first.slice(0, 67) + "...";
  }

  return first;
}

export interface GenerateArtifactCopyArgs {
  prompt: string;
  description: string;
  taskType: string;
  changedFiles: string[];
  llm?: LlmProvider;
}

type LlmCopy = { title: string; body: string } | null;

type RawLlmCopy = { title?: string | null; body?: string | null };

export async function generateArtifactCopy(
  args: GenerateArtifactCopyArgs,
): Promise<CopyResult> {
  const llm = args.llm ?? Llm.instance;
  const fb = fallbackCopy({
    description: args.description,
    taskType: args.taskType,
    changedFiles: args.changedFiles,
  });
  const raw = await askLlm(args.prompt, llm).catch(() => null);

  if (!raw?.title || !raw.body) {
    return fb;
  }

  return { title: raw.title, body: raw.body, source: "llm" };
}

async function askLlm(prompt: string, llm: LlmProvider): Promise<LlmCopy> {
  const result = await llm.completeWithTool<RawLlmCopy>({
    prompt,
    toolName: "artifact_copy",
    toolDescription: "Generate a title and body for an artifact",
    toolSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title", "body"],
    },
  });
  const { title, body } = result.parsed;

  return { title: (title ?? "").trim(), body: (body ?? "").trim() };
}
