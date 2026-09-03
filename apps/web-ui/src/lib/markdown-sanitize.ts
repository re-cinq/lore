import { defaultSchema } from "rehype-sanitize";

/** Sanitize schema for ReactMarkdown; extend GitHub's with mark tag (#1023). */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
};
