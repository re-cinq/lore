// One shipped default agent: `<name>.md`, frontmatter for the row's settings, body for its prompt.

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { enforceTrue } from "../../lib/enforce.js";
import {
  CatalogConfigSchema,
  type ResolvedAgentDefinition,
} from "../models/agent-definition.js";
import { TestPolicySchema } from "../task-types/task-types-config.js";

const ROW_FIELDS = [
  "model",
  "timeout_minutes",
  "execution_mode",
  "review_required",
] as const;

// Strict, unlike the stored config: a misspelled key in a shipped file is a bug to fail on, not a field to carry.
const FrontmatterSchema = z
  .object({
    model: z.string().optional(),
    timeout_minutes: z.number().int().positive().optional(),
    execution_mode: z.string().optional(),
    review_required: z.boolean().optional(),
    ...CatalogConfigSchema.shape,
    test_policy: TestPolicySchema.optional(),
  })
  .strict();

type Frontmatter = z.infer<typeof FrontmatterSchema>;

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export function parseAgentDefaultFile(
  name: string,
  text: string,
): ResolvedAgentDefinition {
  const match = FRONTMATTER.exec(text);

  enforceTrue(match, Error, `${name}.md: missing the --- frontmatter block`);
  const parsed = FrontmatterSchema.safeParse(parseYaml(match[1]) ?? {});

  enforceTrue(
    parsed.success,
    Error,
    `${name}.md: ${parsed.success ? "" : z.prettifyError(parsed.error)}`,
  );
  const body = text.slice(match[0].length);

  return rowFromFrontmatter(name, parsed.data, body === "" ? null : body);
}

function rowFromFrontmatter(
  name: string,
  frontmatter: Frontmatter,
  prompt: string | null,
): ResolvedAgentDefinition {
  return {
    name,
    model: frontmatter.model ?? null,
    timeout_minutes: frontmatter.timeout_minutes ?? null,
    prompt,
    image: null,
    execution_mode: frontmatter.execution_mode ?? "claude-code",
    review_required: frontmatter.review_required ?? false,
    project_id: null,
    config: configOf(frontmatter),
  };
}

// Everything that is not a column rides config, as a stored row carries it.
function configOf(frontmatter: Frontmatter): Record<string, unknown> | null {
  const config = Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([key]) => !(ROW_FIELDS as readonly string[]).includes(key),
    ),
  );

  return Object.keys(config).length > 0 ? config : null;
}
