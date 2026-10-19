import { contentFetchers } from "./context-assembly-fetchers-content.js";
import { socialFetchers } from "./context-assembly-fetchers-social.js";
import type { SourceFetcher } from "./context-assembly-fetchers-types.js";

export type { SourceFetcher } from "./context-assembly-fetchers-types.js";

export const fetchers: Record<string, SourceFetcher> = {
  ...contentFetchers,
  ...socialFetchers,
};
