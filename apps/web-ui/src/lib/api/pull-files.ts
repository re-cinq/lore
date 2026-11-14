import type { components } from "./schema";

// The run page's per-file diff source (specs/assembly-line-run-viz FR8); types alias the generated schema, no hand-mirrored shapes. The browser reads it over the live socket as `GET /api/assembly-runs/{id}/pull-files`.
export type PullFiles = components["schemas"]["PullFiles"];
export type PullFileChange = PullFiles["files"][number];
