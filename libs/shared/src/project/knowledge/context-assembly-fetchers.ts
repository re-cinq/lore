import { contentFetchers } from "./context-assembly-fetchers-content.js";
import { socialFetchers } from "./context-assembly-fetchers-social.js";
import type { SourceFetcher } from "./context-assembly-fetchers-types.js";

export type { SourceFetcher } from "./context-assembly-fetchers-types.js";

// cross_repo has no shipped template section to drive it through assembleContext, hence the direct export.
export const fetchers: Record<string, SourceFetcher> = {
  ...contentFetchers,
  ...socialFetchers,
};
