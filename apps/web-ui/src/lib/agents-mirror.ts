// The agent display type is NOT mirrored any more: `AgentDefinition` is an alias
// over the OpenAPI document lore-api generates from its own route contracts
// (ADR-035), so the shape has one declaration — the `ResolvedAgentDefinition`
// schema in libs/shared/src/models/agent-definition.ts — and
// scripts/check-openapi-drift.sh fails CI when the generated artifact is stale.
// This file previously hand-copied the interface with no drift guard at all.
//
// KNOWN_MODELS stays here on purpose. It is a curated DROPDOWN, not part of any
// response, so no generated type can carry it; the API accepts custom text for
// `model` regardless of what this list offers.

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
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];
