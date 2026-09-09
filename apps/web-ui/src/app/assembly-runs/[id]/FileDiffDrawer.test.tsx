// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import FileDiffDrawer from "./FileDiffDrawer";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const filesBody = {
  files: [
    {
      filename: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1,2 @@\n ctx\n+new",
    },
  ],
};

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderDrawer(path: string | null, prNumber: number | null = 42) {
  const onClose = vi.fn();
  const view = render(
    <FileDiffDrawer
      runId="run-1"
      path={path}
      prNumber={prNumber}
      onClose={onClose}
    />,
  );

  return { ...view, onClose };
}

describe("FileDiffDrawer", () => {
  it("renders nothing and fetches nothing while no path is open", () => {
    const fetchMock = stubFetch(new Response("{}"));

    const { container } = renderDrawer(null);

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("titles the card Diff · path and shows the matched file's diff", async () => {
    stubFetch(new Response(JSON.stringify(filesBody)));

    const { container } = renderDrawer("/workspace/src/a.ts");

    await settle();

    expect(screen.getByText("Diff · /workspace/src/a.ts")).toBeInTheDocument();
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelectorAll("[data-diff-line='add']")).toHaveLength(
      1,
    );
  });

  it("fetches /api/assembly-runs/run-1/pull-files once across path changes", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify(filesBody)));

    const { rerender } = renderDrawer("src/a.ts");

    await settle();
    rerender(
      <FileDiffDrawer
        runId="run-1"
        path="src/b.ts"
        prNumber={42}
        onClose={vi.fn()}
      />,
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/assembly-runs/run-1/pull-files",
    );
    expect(screen.getByText("Not changed in this PR.")).toBeInTheDocument();
  });

  it("says diffs are unavailable for a run without a pull request and fetches nothing", () => {
    const fetchMock = stubFetch(new Response("{}"));

    renderDrawer("src/a.ts", null);

    expect(
      screen.getByText("No pull request for this run — diffs unavailable."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the upstream error message when the fetch fails", async () => {
    stubFetch(
      new Response(JSON.stringify({ error: "GitHub unconfigured" }), {
        status: 424,
      }),
    );

    renderDrawer("src/a.ts");
    await settle();

    expect(
      screen.getByText("Could not load diff: GitHub unconfigured"),
    ).toBeInTheDocument();
  });

  it("closes through the header button without folding the card", async () => {
    stubFetch(new Response(JSON.stringify(filesBody)));

    const { container, onClose } = renderDrawer("src/a.ts");

    await settle();

    const click = fireEvent.click(
      screen.getByRole("button", { name: "Close" }),
    );

    expect(click).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector("details")?.open).toBe(true);
  });
});
