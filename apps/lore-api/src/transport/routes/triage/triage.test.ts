import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock(
  "@re-cinq/lore-shared/floor/floor-client.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@re-cinq/lore-shared/floor/floor-client.js")
    >()),
    floorClient: vi.fn(),
    floorConfigured: () => true,
  }),
);

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("GET /api/repos/{owner}/{repo}/triage", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns issues with triage:* labels joined with their active floor runs. ([validated by FR30])", async () => {
    const pool = makePool();

    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          {
            number: 42,
            title: "A triage issue",
            state: "open",
            labels: ["triage: needs-triage"],
            url: "https://gh/i/42",
          },
        ],
      },
    } as never);

    vi.mocked(floorClient).mockReturnValue({
      runs: {
        list: async () => ({
          items: [
            {
              id: "run-42",
              status: "running",
              pipeline: "issue-triage",
              args: { issue_number: 42 },
            },
          ],
        }),
      },
    } as never);

    const res = await buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/triage",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([
      expect.objectContaining({
        title: "A triage issue",
        triage_label: "triage: needs-triage",
        active_run_link: expect.any(String),
      }),
    ]);
  });
});
