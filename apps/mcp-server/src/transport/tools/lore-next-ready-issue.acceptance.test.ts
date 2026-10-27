import { describe, expect, it, vi } from "vitest";
import { registerRepoTools } from "./repo-tools.js";
import { toolHandlers } from "./tool-test-helpers.js";
import { proxyGetApi } from "./deps.js";

vi.mock("./deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deps.js")>()),
  proxyGetApi: vi.fn(),
}));

function handlerFor(name: string) {
  return toolHandlers(registerRepoTools, "full")[name];
}

describe("lore_next_ready_issue tool", () => {
  it("returns one issue plus `because`, and the issue equals the loop's own next pick for that repo", async () => {
    const handler = handlerFor("lore_next_ready_issue");

    expect(handler).toBeDefined();

    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: true,
      body: JSON.stringify({
        next: [
          {
            number: 42,
            title: "Next pick",
            url: "https://github.com/acme/widgets/issues/42",
          },
        ],
      }),
    });

    const result = await handler({ repo: "acme/widgets" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.issue).toMatchObject({
      number: 42,
      title: "Next pick",
    });
    expect(parsed.because).toBeDefined();
  });

  it("{repo} with nothing ready returns an empty result and a reason, not an error", async () => {
    const handler = handlerFor("lore_next_ready_issue");

    expect(handler).toBeDefined();

    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: true,
      body: JSON.stringify({ next: [] }),
    });

    const result = await handler({ repo: "acme/widgets" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.issue).toBeNull();
    expect(parsed.reason).toBeDefined();
  });

  it("Two runs against an unchanged backlog return the same issue", async () => {
    const handler = handlerFor("lore_next_ready_issue");
    const payload = JSON.stringify({
      next: [
        {
          number: 42,
          title: "Next pick",
          url: "https://github.com/acme/widgets/issues/42",
        },
      ],
    });

    vi.mocked(proxyGetApi)
      .mockResolvedValueOnce({ ok: true, body: payload })
      .mockResolvedValueOnce({ ok: true, body: payload });

    const first = JSON.parse(
      (await handler({ repo: "acme/widgets" })).content[0].text,
    );
    const second = JSON.parse(
      (await handler({ repo: "acme/widgets" })).content[0].text,
    );

    expect(first.issue).toEqual(second.issue);
    expect(first.because).toEqual(second.because);
  });
});
