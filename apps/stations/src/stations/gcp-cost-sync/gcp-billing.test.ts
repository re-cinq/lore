import { describe, it, expect } from "vitest";
import {
  buildBillingQuery,
  parseBillingQueryResponse,
  pickBillingTable,
} from "./gcp-billing.js";

describe("pickBillingTable", () => {
  it("picks the standard export table by its gcp_billing_export_v1_ prefix", () => {
    expect(
      pickBillingTable([
        "some_other_table",
        "gcp_billing_export_v1_0132C7_8857EC_2D094D",
      ]),
    ).toBe("gcp_billing_export_v1_0132C7_8857EC_2D094D");
  });

  it("prefers the standard table over the detailed resource-level one", () => {
    expect(
      pickBillingTable([
        "gcp_billing_export_resource_v1_0132C7_8857EC_2D094D",
        "gcp_billing_export_v1_0132C7_8857EC_2D094D",
      ]),
    ).toBe("gcp_billing_export_v1_0132C7_8857EC_2D094D");
  });

  it("falls back to the detailed table when only that export is enabled", () => {
    expect(
      pickBillingTable(["gcp_billing_export_resource_v1_0132C7_8857EC_2D094D"]),
    ).toBe("gcp_billing_export_resource_v1_0132C7_8857EC_2D094D");
  });

  it("returns null for a dataset with no export table yet", () => {
    expect(pickBillingTable(["lore_platform_traces"])).toBeNull();
  });
});

describe("buildBillingQuery", () => {
  const sql = buildBillingQuery(
    {
      project: "re5-n8n-platform",
      dataset: "billing_export",
      tableId: "gcp_billing_export_v1_0132C7_8857EC_2D094D",
    },
    "2026-08-04T00:00:00.000Z",
  );

  it("reads the fully qualified export table windowed on usage_start_time", () => {
    expect(sql).toContain(
      "`re5-n8n-platform.billing_export.gcp_billing_export_v1_0132C7_8857EC_2D094D`",
    );
    expect(sql).toContain(
      "usage_start_time >= TIMESTAMP('2026-08-04T00:00:00.000Z')",
    );
  });

  it("filters to the platform's own project, since the export spans the whole billing account", () => {
    expect(sql).toContain("project.id = 're5-n8n-platform'");
  });

  it("groups per UTC day and service with credits summed apart from cost", () => {
    expect(sql).toContain("DATE(usage_start_time, 'UTC')");
    expect(sql).toContain("GROUP BY bucket_date, service");
    expect(sql).toContain("UNNEST(credits)");
  });
});

describe("parseBillingQueryResponse", () => {
  it("maps the stringly f/v cells to day/service rows in column order", () => {
    expect(
      parseBillingQueryResponse({
        jobComplete: true,
        rows: [
          {
            f: [
              { v: "2026-09-01" },
              { v: "Kubernetes Engine" },
              { v: "14.621387" },
              { v: "-1.31" },
            ],
          },
          {
            f: [
              { v: "2026-09-01" },
              { v: "Networking" },
              { v: "0.42" },
              { v: "0" },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        bucketDate: "2026-09-01",
        service: "Kubernetes Engine",
        costUsd: 14.621387,
        creditsUsd: -1.31,
      },
      {
        bucketDate: "2026-09-01",
        service: "Networking",
        costUsd: 0.42,
        creditsUsd: 0,
      },
    ]);
  });

  it("returns no rows for a completed query over an empty window", () => {
    expect(parseBillingQueryResponse({ jobComplete: true })).toEqual([]);
  });

  it("throws when the query job did not complete in time", () => {
    expect(() => parseBillingQueryResponse({ jobComplete: false })).toThrow(
      "BigQuery billing query did not complete in time",
    );
  });
});
