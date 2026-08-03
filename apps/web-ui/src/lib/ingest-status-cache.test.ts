import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getIngestStatuses,
  clearIngestStatusCache,
  INGEST_STATUS_TTL_MS,
} from "./ingest-status-cache";
import type { IngestWorkflowStatus } from "./ingest-workflow";

const statusByRepo: Record<string, IngestWorkflowStatus> = {
  "acme/api": "aligned",
  "acme/web": "missing",
  "acme/infra": "stale",
};

const fetcher = () =>
  vi.fn((repo: string) => Promise.resolve(statusByRepo[repo]));

beforeEach(() => {
  clearIngestStatusCache();
});

describe("getIngestStatuses", () => {
  it("fetches each repo once on a cold cache and returns per-repo statuses", async () => {
    const fetch = fetcher();

    const statuses = await getIngestStatuses(
      ["acme/api", "acme/web", "acme/infra"],
      fetch,
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(Object.fromEntries(statuses)).toEqual({
      "acme/api": "aligned",
      "acme/web": "missing",
      "acme/infra": "stale",
    });
  });

  it("performs zero fetches on a second call inside the TTL", async () => {
    const fetch = fetcher();

    await getIngestStatuses(["acme/api", "acme/web"], fetch);
    const statuses = await getIngestStatuses(["acme/api", "acme/web"], fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(statuses)).toEqual({
      "acme/api": "aligned",
      "acme/web": "missing",
    });
  });

  it("refetches an entry whose TTL has expired", async () => {
    const fetch = fetcher();
    let clock = 1000;

    await getIngestStatuses(["acme/api"], fetch, () => clock);
    clock += INGEST_STATUS_TTL_MS;
    await getIngestStatuses(["acme/api"], fetch, () => clock);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fetches only the repos missing from the cache on a partial hit", async () => {
    const fetch = fetcher();

    await getIngestStatuses(["acme/api"], fetch);
    const statuses = await getIngestStatuses(["acme/api", "acme/web"], fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(2, "acme/web");
    expect(Object.fromEntries(statuses)).toEqual({
      "acme/api": "aligned",
      "acme/web": "missing",
    });
  });

  it('resolves a rejected fetch to "aligned" and caches the fallback', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("rate limited")));

    const statuses = await getIngestStatuses(["acme/api"], fetch);
    const again = await getIngestStatuses(["acme/api"], fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(statuses.get("acme/api")).toBe("aligned");
    expect(again.get("acme/api")).toBe("aligned");
  });

  it("shares one in-flight fetch per repo across concurrent calls", async () => {
    let resolve: (s: IngestWorkflowStatus) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<IngestWorkflowStatus>((r) => {
          resolve = r;
        }),
    );

    const first = getIngestStatuses(["acme/api"], fetch);
    const second = getIngestStatuses(["acme/api"], fetch);

    resolve("stale");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await first).get("acme/api")).toBe("stale");
    expect((await second).get("acme/api")).toBe("stale");
  });

  it("refetches after clearIngestStatusCache", async () => {
    const fetch = fetcher();

    await getIngestStatuses(["acme/api"], fetch);
    clearIngestStatusCache();
    await getIngestStatuses(["acme/api"], fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
