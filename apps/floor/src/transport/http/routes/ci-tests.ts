/** POST /api/webhook/ci-tests — Layer-1 test-report ingest producer: lore-code-trace bearer-authenticates, `mapCiTests` maps the body to an event we INSERT, the loop dispatches; the report itself is kept as the branch's latest (pipeline.test_reports) for the Definition-of-Done read. */

import { enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import type {
  NewTestReport,
  ReportedTest,
  TestDescriptor,
  TestReportsRepository,
} from "@re-cinq/lore-shared";
import {
  mapCiTests,
  type CiTestsBody,
} from "../../../events/listeners/ci-tests-map.js";
import { insertEventList } from "../../../outbound/event-store.js";
import { testReports } from "../../../outbound/queues.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export interface CiTestsRouteDeps {
  testReports?: TestReportsRepository;
}

interface PostedResult {
  id: string;
  passed: boolean;
}

/** The descriptor trimmed to what a Definition-of-Done match needs; coverage ranges and spec anchors stay in the graph. */
function reportedTest(descriptor: TestDescriptor): ReportedTest {
  return {
    id: descriptor.id,
    name: descriptor.name,
    file: descriptor.file,
    ...(descriptor.suite ? { suite: descriptor.suite } : {}),
    ...(descriptor.startLine !== undefined
      ? { startLine: descriptor.startLine }
      : {}),
  };
}

/** The persisted shape of a posted body, or null when it names no branch — a report no run can be matched to is not worth a row. The mapper has already required repo and commit. */
export function testReportFromBody(body: CiTestsBody): NewTestReport | null {
  if (!body.repo || !body.commit || !body.branch) {
    return null;
  }
  const results = (body.results ?? []) as PostedResult[];

  return {
    repo: body.repo,
    commit: body.commit,
    branch: body.branch,
    tests: ((body.tests ?? []) as TestDescriptor[]).map(reportedTest),
    outcomes: Object.fromEntries(results.map((r) => [r.id, r.passed])),
  };
}

export function ciTestsRoute(deps: CiTestsRouteDeps = {}): ServerRoute {
  return {
    method: "POST",
    path: "/api/webhook/ci-tests",
    options: { auth: "ingest-token", payload: { parse: false } },
    handler: async (request, h) => {
      const body = parseJsonBody<CiTestsBody>(rawBody(request), "ci-tests");
      const mapped = mapCiTests(body);

      // A validation failure is a client error — 400 surfaces the mapper's message instead of a generic 500.
      enforceOk(mapped, apiError(400));

      await insertEventList(mapped.events, "ci-tests");
      const report = testReportFromBody(body);

      if (report) {
        await (deps.testReports ?? testReports()).upsertLatest(report);
      }

      return h.response({ ingested: mapped.events.length }).code(202);
    },
  };
}
