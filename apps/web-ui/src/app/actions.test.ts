// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const openIngestWorkflowPR = vi.fn();
const openTraceImpactWorkflowPR = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/github", () => ({
  openIngestWorkflowPR: (...a: unknown[]) => openIngestWorkflowPR(...a),
  openTraceImpactWorkflowPR: (...a: unknown[]) =>
    openTraceImpactWorkflowPR(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import { fixIngestWorkflows, fixTraceImpactWorkflows } from "./actions";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
} from "@/lib/ingest-workflow";
import { getIngestStatuses } from "@/lib/ingest-status-cache";

beforeEach(() => {
  openIngestWorkflowPR.mockReset();
  openTraceImpactWorkflowPR.mockReset();
  revalidatePath.mockReset();
});

describe("fixIngestWorkflows", () => {
  it("opens a PR per repo with the canonical path and content", async () => {
    openIngestWorkflowPR
      .mockResolvedValueOnce({ url: "https://gh/a/1", number: 1 })
      .mockResolvedValueOnce({ url: "https://gh/b/2", number: 2 });

    const result = await fixIngestWorkflows(["re-cinq/a", "re-cinq/b"]);

    expect(openIngestWorkflowPR).toHaveBeenCalledWith(
      "re-cinq/a",
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
    );
    expect(openIngestWorkflowPR).toHaveBeenCalledWith(
      "re-cinq/b",
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
    );
    expect(result).toEqual({
      opened: 2,
      prs: ["https://gh/a/1", "https://gh/b/2"],
      failed: [],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("reports each repo where no PR was opened with the reason instead of swallowing it", async () => {
    openIngestWorkflowPR
      .mockResolvedValueOnce({ url: "https://gh/a/1", number: 1 })
      .mockRejectedValueOnce(
        new Error(
          "Resource not accessible by integration - workflows permission",
        ),
      )
      .mockResolvedValueOnce(null);

    const result = await fixIngestWorkflows([
      "re-cinq/a",
      "re-cinq/b",
      "re-cinq/c",
    ]);

    expect(result).toEqual({
      opened: 1,
      prs: ["https://gh/a/1"],
      failed: [
        {
          repo: "re-cinq/b",
          error:
            "Resource not accessible by integration - workflows permission",
        },
        {
          repo: "re-cinq/c",
          error:
            "no PR was opened (GitHub App not configured, or no open fix PR found for the existing fix branch)",
        },
      ],
    });
  });

  it("reports trace-impact fix failures per repo the same way", async () => {
    openTraceImpactWorkflowPR.mockRejectedValueOnce(new Error("boom"));

    const result = await fixTraceImpactWorkflows(["re-cinq/a"]);

    expect(result).toEqual({
      opened: 0,
      prs: [],
      failed: [{ repo: "re-cinq/a", error: "boom" }],
    });
  });

  it("evicts cached ingest statuses so the revalidated page refetches", async () => {
    openIngestWorkflowPR.mockResolvedValueOnce(null);
    const fetchStatus = vi.fn(() => Promise.resolve("aligned" as const));

    await getIngestStatuses(["re-cinq/a"], fetchStatus);
    await fixIngestWorkflows(["re-cinq/a"]);
    await getIngestStatuses(["re-cinq/a"], fetchStatus);

    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});
