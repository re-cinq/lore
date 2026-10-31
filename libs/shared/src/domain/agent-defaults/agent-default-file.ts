// One shipped agent: `<name>.md`, its frontmatter the settings the floor is seeded with, its body the prompt (#3995).

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { enforceTrue } from "../../lib/enforce.js";
import {
  CatalogConfigSchema,
  type ResolvedAgentDefinition,
} from "../models/agent-definition.js";

const PriceSchema = z
  .object({
    input_per_million: z.number(),
    output_per_million: z.number(),
    cache_read_per_million: z.number().optional(),
  })
  .strict();

// Strict, unlike the stored config: a misspelled key in a shipped file is a bug to fail on, not a field to carry.
const FrontmatterSchema = z
  .object({
    model: z.string().optional(),
    image: z.string().optional(),
    timeout_minutes: z.number().int().positive().optional(),
    prices: z.record(z.string(), PriceSchema).optional(),
    config: CatalogConfigSchema.optional(),
    execution_mode: z.string().optional(),
    review_required: z.boolean().optional(),
  })
  .strict();

type Frontmatter = z.infer<typeof FrontmatterSchema>;

export interface AgentDefaultFile {
  name: string;
  frontmatter: Frontmatter;
  // As written: the validated copy reorders config's keys, and the floor is handed the file's order.
  written: Record<string, unknown>;
  prompt: string | null;
}

/** The settings block a floor agent definition carries, as a pipeline file once wrote it. */
export type FloorAgentSettings = Pick<
  Frontmatter,
  "model" | "image" | "timeout_minutes" | "prices" | "config"
> & { prompt: string | null };

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export function readAgentDefaultFile(
  name: string,
  text: string,
): AgentDefaultFile {
  const match = FRONTMATTER.exec(text);

  enforceTrue(match, Error, `${name}.md: missing the --- frontmatter block`);
  const written = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const body = text.slice(match[0].length);

  return {
    name,
    frontmatter: validated(name, written),
    written,
    prompt: body === "" ? null : body,
  };
}

function validated(name: string, written: Record<string, unknown>) {
  const parsed = FrontmatterSchema.safeParse(written);

  enforceTrue(
    parsed.success,
    Error,
    `${name}.md: ${parsed.success ? "" : z.prettifyError(parsed.error)}`,
  );

  return parsed.data;
}

export function parseAgentDefaultFile(
  name: string,
  text: string,
): ResolvedAgentDefinition {
  return rowOf(readAgentDefaultFile(name, text));
}

export function rowOf(file: AgentDefaultFile): ResolvedAgentDefinition {
  const { frontmatter } = file;

  return {
    name: file.name,
    ...settingsOrNull(frontmatter),
    prompt: file.prompt,
    execution_mode: frontmatter.execution_mode ?? "claude-code",
    review_required: frontmatter.review_required ?? false,
    project_id: null,
  };
}

function settingsOrNull(frontmatter: Frontmatter) {
  return {
    model: frontmatter.model ?? null,
    timeout_minutes: frontmatter.timeout_minutes ?? null,
    image: frontmatter.image ?? null,
    config: frontmatter.config ?? null,
  };
}

const FLOOR_KEYS = new Set([
  "model",
  "image",
  "timeout_minutes",
  "prices",
  "config",
]);

// The keys a pipeline file's `settings` held, in the file's order; a key the file leaves out stays out.
export function floorSettingsOf(file: AgentDefaultFile): FloorAgentSettings {
  return {
    ...Object.fromEntries(
      Object.entries(file.written).filter(([key]) => FLOOR_KEYS.has(key)),
    ),
    prompt: file.prompt,
  };
}
