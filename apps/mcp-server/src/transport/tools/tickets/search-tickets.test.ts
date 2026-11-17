import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
}));

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi } from "../shared/deps.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerSearchTicketsTool } from "./search-tickets.js";

const searchTickets = (mode: ServerMode = "full") =>
  toolHandlers(registerSearchTicketsTool, mode)["lore_search_tickets"];

const proxy = vi.mocked(proxyGetApi);

const answer = (body: object) =>
  proxy.mockResolvedValue({ ok: true, body: JSON.stringify(body) });

afterEach(() => {
  vi.clearAllMocks();
});

describe("lore_search_tickets", () => {
  it("asks the detected repo's ticket search with the query, state and limit", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    answer({ tickets: [] });

    await searchTickets()({ query: "flaky ci", state: "open", limit: 5 });

    expect(proxy.mock.calls[0]?.[0]).toBe(
      "/api/repos/re-cinq/lore/tickets/search?query=flaky+ci&state=open&limit=5",
    );
  });

  it("prints closed #12 with its state, title, score, url and excerpt", async () => {
    answer({
      tickets: [
        {
          number: 12,
          title: "Search tickets",
          state: "closed",
          labels: [],
          url: "https://github.com/re-cinq/lore/issues/12",
          score: 0.9123,
          excerpt: "Agents file duplicates",
        },
      ],
    });

    const result = await searchTickets()({
      query: "duplicates",
      state: "all",
      limit: 10,
      repo: "re-cinq/lore",
    });

    expect(result.content[0].text).toBe(
      "#12 [closed] Search tickets (0.912) https://github.com/re-cinq/lore/issues/12\n    Agents file duplicates",
    );
  });

  it("says no ticket matched and prints the API's note", async () => {
    answer({
      tickets: [],
      notes: ["search_tickets: re-cinq/lore has no Utopia base"],
    });

    const result = await searchTickets()({
      query: "anything",
      state: "all",
      limit: 10,
      repo: "re-cinq/lore",
    });

    expect(result.content[0].text).toBe(
      'No tickets match "anything".\n\nsearch_tickets: re-cinq/lore has no Utopia base',
    );
  });

  it("refuses a search with no repo on the gateway", async () => {
    const result = await searchTickets("agent")({
      query: "anything",
      state: "all",
      limit: 10,
    });

    expect(result.content[0].text).toMatch(/^No repo given/);
  });

  it("reports a failed API read as text", async () => {
    proxy.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "HTTP 500",
    });

    const result = await searchTickets()({
      query: "anything",
      state: "all",
      limit: 10,
      repo: "re-cinq/lore",
    });

    expect(result.content[0].text).toBe(
      "Could not fetch tickets from the Lore API: HTTP 500",
    );
  });
});
