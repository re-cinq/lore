// The assembly's backend half (ADR-052 amendment 2026-10-16): the empty Utopia assembly, and how a side-by-side assembly labels each store's half. Pure: value in, value out.

import type { KnowledgeBackend } from "../../../domain/knowledge-backend.js";
import { serializeContext } from "./context-assembly-format.js";
import { assemblyBudget } from "./context-assembly-budget.js";

/** The part of an assembly a backend label touches. */
export interface BackendAssembly {
  text: string;
  sections: { header: string; tokens: number; truncated: boolean }[];
}

/** Utopia's assembly where it cannot be read (no mirror or no reader): an empty block on the template and budget Lore's would use, every section left out rather than saying it has no Utopia reader. */
export function utopiaAssemblyFor(
  query: string,
  options: { templateName?: string; maxTokens?: number },
): BackendAssembly {
  const template = options.templateName ?? "default";
  const budget = assemblyBudget(template, options.maxTokens);

  return {
    text: serializeContext({ query, template, budget }, []),
    sections: [],
  };
}

/** Lore's assembly then Utopia's, each wrapped in a `<backend>` block and each section header prefixed with its store. Everything else (trace, context refs) stays Lore's: Utopia contributes neither yet. */
export function labelledByBackend<T extends BackendAssembly>(
  lore: T,
  utopia: BackendAssembly,
): T {
  return {
    ...lore,
    text: `${backendBlock("lore", lore.text)}\n${backendBlock("utopia", utopia.text)}`,
    sections: [
      ...labelledSections("lore", lore.sections),
      ...labelledSections("utopia", utopia.sections),
    ],
  };
}

function backendBlock(backend: KnowledgeBackend, text: string): string {
  return `<backend name="${backend}">\n${text}\n</backend>`;
}

function labelledSections(
  backend: KnowledgeBackend,
  sections: BackendAssembly["sections"],
): BackendAssembly["sections"] {
  return sections.map((section) => ({
    ...section,
    header: `${backend}: ${section.header}`,
  }));
}
