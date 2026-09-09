// AgentDefinition aliases the OpenAPI-generated schema (ADR-035; scripts/check-openapi-drift.sh guards it) — no longer hand-copied. KNOWN_MODELS stays here: a curated dropdown, not part of any response.
import type { components } from "./api/schema";

/** One resolved agent definition, as the API serves it. */
export type AgentDefinition = Extract<
  components["schemas"]["AgentDefinitionRead"],
  { name: string }
>;

export const KNOWN_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];
