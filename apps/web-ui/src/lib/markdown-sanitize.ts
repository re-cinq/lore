import { defaultSchema } from "rehype-sanitize";

/**
 * Shared sanitize schema for every ReactMarkdown pipeline that parses raw
 * HTML via rehype-raw (ReadmeBox, ChunkBody, SpecDetails). react-markdown
 * v10 has no built-in sanitizer, so repo-sourced markdown (READMEs, ingested
 * chunks, specs) would otherwise execute injected `<script>` / `onerror` /
 * `javascript:` payloads in every viewer's browser (stored XSS, #1023).
 *
 * `rehypeSanitize` must run immediately AFTER `rehypeRaw` and BEFORE any
 * trusted tree decoration (rehype-highlight's `hljs-*` classes, SpecDetails'
 * statement `<mark data-ordinal>` wrappers) so the decoration survives.
 *
 * The only extension over GitHub's defaultSchema is the presentational
 * `<mark>` tag, which READMEs legitimately hand-write. Its attributes are
 * deliberately NOT extended: user-authored marks keep only the global
 * allowlist (no `class`, no `data-*`), so repo content cannot spoof
 * SpecDetails' `<mark data-ordinal>` statement wrappers.
 */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
};
