// The block's opening: what the repository says about itself, or the list of what it holds when it says nothing.

import type { LlmProvider } from "../../outbound/llm/llm-provider.js";
import { topLevelEntries } from "./candidate-paths.js";

export interface PrimerSources {
  documents: { name: string; text: string }[];
  tree: string[];
}

/** The files a repository describes itself in, in the order they are read. */
export const PRIMER_DOCUMENTS = ["CLAUDE.md", "AGENTS.md", "README.md"];

const MAX_DOCUMENT_CHARS = 30_000;

const PRIMER_SYSTEM =
  "You write a repository primer for AI coding agents. State only what the files say; never infer a rule.";

const PRIMER_ASK = [
  "From the files below, write a primer of at most 250 words in markdown bullets:",
  "what the repository is, its main parts and where they live, where its specs, ADRs and tests are,",
  "and up to 5 rules the files state.",
].join(" ");

export async function writePrimer(
  llm: LlmProvider,
  sources: PrimerSources,
): Promise<string> {
  if (sources.documents.length === 0) {
    return `(No CLAUDE.md, AGENTS.md or README. Top-level entries: ${topLevelEntries(sources.tree).join(", ")})`;
  }
  const written = await llm.complete({
    systemPrompt: PRIMER_SYSTEM,
    prompt: [PRIMER_ASK, ...sources.documents.map(documentBlock)].join("\n\n"),
    temperature: 0,
    jobName: "context-builder",
  });

  return written.text.trim();
}

function documentBlock(document: { name: string; text: string }): string {
  return `## ${document.name}\n${document.text.slice(0, MAX_DOCUMENT_CHARS)}`;
}
