// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/backlog", () => ({ getImplementationLoop: vi.fn() }));
vi.mock("@/lib/api/code-review", () => ({ getCodeReview: vi.fn() }));
vi.mock("@/lib/api/triage", () => ({ getIssueTriage: vi.fn() }));

import { getImplementationLoop } from "@/lib/api/backlog";
import { getCodeReview } from "@/lib/api/code-review";
import type { RepoLoop } from "@/lib/api/loops";
import { readLoop } from "./read-loop";

const loop = (key: RepoLoop["key"], label: string): RepoLoop => ({
  key,
  label,
  description: "",
  enabled: true,
});

describe("readLoop", () => {
  it("reads code review through its client and names it when lore-api answers HTTP 502", async () => {
    vi.mocked(getCodeReview).mockResolvedValue({
      status: "error",
      message: "HTTP 502",
    });

    const read = await readLoop(loop("review", "Code review"), "re-cinq/lore");

    expect({
      asked: vi.mocked(getCodeReview).mock.calls,
      sections: read.sections,
      failure: read.failure,
    }).toEqual({
      asked: [["re-cinq/lore"]],
      sections: null,
      failure:
        "Could not load Code review (HTTP 502) — check the Lore API connection and reload.",
    });
  });

  it("hands the implementation read to the onboarding banner and adds no second waiting-for-onboarding notice above the backlog", async () => {
    const backlog = {
      enabled: true,
      onboarding: { merged: false, pr_url: null, last_task: null },
      current: [],
      current_run_id: null,
      next: [],
      parked: [],
      recent: [],
      awaiting_merge: [],
    };

    vi.mocked(getImplementationLoop).mockResolvedValue({
      status: "ok",
      data: backlog,
    } as never);

    const read = await readLoop(
      loop("implementation", "Implementation loop"),
      "re-cinq/lore",
    );

    expect({ notice: read.backlogNotice, banner: read.implementation }).toEqual(
      {
        notice: undefined,
        banner: backlog,
      },
    );
  });
});
