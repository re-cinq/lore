// Every station this service answers to, by name.
//
// One entry per station — adding one is a line here plus the module it points
// at. The name is the URL: `POST /api/stations/<name>`.

import { approvalCheckJob } from "./stations/approval-check.js";
import { mergeCheckJob } from "./stations/merge-check.js";
import type { StationRegistry } from "./delivery/routes/stations.js";

export const stations: StationRegistry = new Map([
  ["approval-check", approvalCheckJob],
  ["merge-check", mergeCheckJob],
]);
