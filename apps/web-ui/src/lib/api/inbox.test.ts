// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InboxResponse } from "./inbox";

vi.mock("server-only", () => ({}));

const { getInbox, openInboxCount } = await import("./inbox");

const wireInbox: InboxResponse = {
  items: [],
  counts: { failed_run: 2, spec_pr: 3 },
  next_cursor: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(wireInbox)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getInbox", () => {
  it("reads /api/inbox from lore-api with no query when none is given", async () => {
    const result = await getInbox();

    expect({
      url: String(fetchMock.mock.calls[0][0]),
      status: result.status,
    }).toEqual({
      url: "http://api:3000/api/inbox",
      status: "ok",
    });
  });

  it("appends repo, kind, include and cursor parameters when provided", async () => {
    await getInbox({
      repo: "re-cinq/lore",
      kind: ["failed_run", "spec_pr"],
      include: "snoozed",
      cursor: "page-2",
    });
    const asked = new URL(String(fetchMock.mock.calls[0][0]));

    expect(`${asked.pathname}${asked.search}`).toBe(
      "/api/inbox?repo=re-cinq%2Flore&kind=failed_run&kind=spec_pr&include=snoozed&cursor=page-2",
    );
  });
});

describe("openInboxCount", () => {
  it("sums the open item counts across every kind", () => {
    expect(openInboxCount({ failed_run: 2, spec_pr: 3, plan_review: 1 })).toBe(
      6,
    );
    expect(openInboxCount({})).toBe(0);
  });
});
