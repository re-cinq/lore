import { z } from "zod";

// Agent CONFIG (ADR-024) as Lore reads it off the floor (#3995): a definition's settings are the org default, a repo's variant its override. No table stores it.

const PodResourcesSchema = z.object({
  requests: z.record(z.string(), z.string()).optional(),
  limits: z.record(z.string(), z.string()).optional(),
});

export const CatalogConfigSchema = z
  .object({
    skills: z.array(z.string()).optional(),
    pod_resources: PodResourcesSchema.optional(),
    disallowed_tools: z.array(z.string()).optional(),
    // `upload` sends the watched file's bytes to the Floor instead of inlining them in the event, for artifacts that outgrow the event stream.
    watch: z
      .object({
        event: z.string(),
        path: z.string(),
        upload: z.boolean().optional(),
      })
      .optional(),
    // Files the pod downloads into the workspace before the agent starts; `source` names what the Floor serves at that path.
    inputs: z
      .array(
        z.object({
          path: z.string(),
          source: z.enum(["plan", "digest-draft"]),
        }),
      )
      .optional(),
    repo_workdir: z.boolean().optional(),

    command: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    pod_labels: z.record(z.string(), z.string()).optional(),
    needs_model: z.boolean().optional(),
  })
  .passthrough();

export type CatalogConfig = z.infer<typeof CatalogConfigSchema>;

// The RESOLVED (variant → org) wire shape; keys stay snake_case since the station runner reads it from a separate image.
export const ResolvedAgentDefinitionSchema = z.object({
  name: z.string(),
  model: z.string().nullable(),
  timeout_minutes: z.number().nullable(),
  prompt: z.string().nullable(),
  image: z.string().nullable(),
  execution_mode: z.string(),
  review_required: z.boolean(),
  project_id: z.string().nullable(),
  config: CatalogConfigSchema.nullable(),
});

export type ResolvedAgentDefinition = z.infer<
  typeof ResolvedAgentDefinitionSchema
>;
