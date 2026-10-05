import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@re-cinq/lore-shared")>();

  return { ...actual, createDgraphClient: vi.fn(), dropOverlay: vi.fn() };
});

import { createDgraphClient, dropOverlay } from "@re-cinq/lore-shared";

const originalEnv = { ...process.env };

const drop = (payload: unknown) =>
  buildServer(() => makePool() as never).inject({
    method: "POST",
    url: "/api/repos/o/r/trace/overlay-drop",
    headers: AUTH,
    payload: JSON.stringify(payload),
  });

describe("POST /api/repos/:owner/:repo/trace/overlay-drop", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(createDgraphClient).mockReturnValue({} as never);
    vi.mocked(dropOverlay).mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("drops the overlay of branch lore/implementation-loop/issue-7 for o/r and answers dropped", async () => {
    const res = await drop({ branch: "lore/implementation-loop/issue-7" });

    expect(res.result).toEqual({ dropped: true });
    expect(vi.mocked(dropOverlay).mock.calls[0].slice(1)).toEqual([
      "o/r",
      "lore/implementation-loop/issue-7",
    ]);
  });

  it("answers 400 when no branch is named", async () => {
    const res = await drop({});

    expect(res.statusCode).toBe(400);
    expect(dropOverlay).not.toHaveBeenCalled();
  });

  it("answers dropped false and writes nothing when no graph is configured", async () => {
    vi.mocked(createDgraphClient).mockReturnValue(null);
    const res = await drop({ branch: "feat/x" });

    expect(res.result).toEqual({ dropped: false });
    expect(dropOverlay).not.toHaveBeenCalled();
  });
});
