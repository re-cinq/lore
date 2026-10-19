// The assembly's backend half (ADR-052 amendment 2026-10-16): what Utopia answers while it has no reader, and how a side-by-side assembly labels each store's half. Pure: value in, value out.

import {
  noUtopiaReader,
  type KnowledgeBackend,
} from "../../../domain/knowledge-backend.js";
import { estimateTokens } from "./context-assembly-items.js";
import {
  serializeContext,
  type ContextMeta,
  type SerializedSection,
} from "./context-assembly-format.js";
import {
  activeSections,
  getTemplate,
  type TemplateSection,
} from "./context-assembly-templates.js";
import { assemblyBudget } from "./context-assembly-budget.js";

/** The part of an assembly a backend label touches. */
export interface BackendAssembly {
  text: string;
  sections: { header: string; tokens: number; truncated: boolean }[];
}

/** Utopia's assembly for a request, on the template and budget Lore's would use. */
export function utopiaAssemblyFor(
  query: string,
  options: { templateName?: string; maxTokens?: number; crossRepo?: boolean },
): BackendAssembly {
  const template = options.templateName ?? "default";

  return utopiaAssembly(
    { query, template, budget: assemblyBudget(template, options.maxTokens) },
    activeSections(getTemplate(template), options),
  );
}

/** Utopia's assembly: one short section per source the template asks for, each saying it has no Utopia reader yet — never Lore's data under Utopia's name. */
export function utopiaAssembly(
  meta: ContextMeta,
  sections: TemplateSection[],
): BackendAssembly {
  const serialized = sections.map(noReaderSection);

  return {
    text: serializeContext(meta, serialized),
    sections: serialized.map(({ header, documents }) => ({
      header,
      tokens: documents[0].tokens,
      truncated: false,
    })),
  };
}

function noReaderSection(section: TemplateSection): SerializedSection {
  const text = noUtopiaReader(section.source);

  return {
    header: section.header,
    source: section.source,
    priority: section.priority,
    documents: [{ text, tokens: estimateTokens(text) }],
    truncated: false,
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
