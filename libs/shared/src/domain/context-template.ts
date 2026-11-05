import { z } from "zod";

/** The section-ordering profiles context assembly ships, one per YAML in libs/server-core/templates. */
export const ContextTemplateSchema = z.enum([
  "default",
  "review",
  "implementation",
  "research",
]);

export type ContextTemplate = z.infer<typeof ContextTemplateSchema>;
