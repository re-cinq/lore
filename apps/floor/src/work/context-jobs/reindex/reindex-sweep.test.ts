import { describe, it, expect, vi, afterEach } from "vitest";
import { sweep } from "./reindex.js";

const REPO = "octo/repo";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sweep", () => {
  it("returns 12 when the pass ingests 12 files", async () => {
    expect(await sweep(REPO, "Backfill sweep", async () => 12)).toBe(12);
  });

  it("returns 0 when the pass reports no count", async () => {
    expect(await sweep(REPO, "Verification pass", async () => undefined)).toBe(
      0,
    );
  });

  it("returns 0 and names the failed pass when it throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const counted = await sweep(REPO, "Chunker heal sweep", async () => {
      throw new Error("dgraph unreachable");
    });

    expect(counted).toBe(0);
    expect(logged).toHaveBeenCalledWith(
      "[job] Chunker heal sweep failed for octo/repo: dgraph unreachable",
    );
  });

  it("does not rethrow, so a later pass still runs after an earlier one fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];

    const first = await sweep(REPO, "Chunker heal sweep", async () => {
      order.push("heal");

      throw new Error("boom");
    });
    const second = await sweep(REPO, "Backfill sweep", async () => {
      order.push("backfill");

      return 3;
    });

    expect({ first, second, order }).toEqual({
      first: 0,
      second: 3,
      order: ["heal", "backfill"],
    });
  });
});
