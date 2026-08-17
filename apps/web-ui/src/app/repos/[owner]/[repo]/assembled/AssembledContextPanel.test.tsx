// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AssembledContextPanel from "./AssembledContextPanel";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

const sampleResult = {
  text: "<context></context>",
  sections: [{ header: "Conventions", tokens: 1200, truncated: false }],
  trace: {
    query: "add auth",
    template: "implementation",
    effectiveBudget: 8000,
    crossRepo: false,
    templateSections: [],
    sections: [
      {
        header: "Conventions",
        source: "repo",
        priority: 1,
        status: "ok",
        allocatedBudget: 4000,
        rawTokens: 1200,
        finalTokens: 1200,
        truncated: false,
        included: true,
        items: [
          {
            text: "CLAUDE",
            tokens: 1200,
            source_path: "CLAUDE.md",
            content_type: "doc",
          },
        ],
      },
    ],
    budget: { total: 8000, used: 1200, leftover: 6800 },
    freshness: { state: "fresh", message: "" },
    timingsMs: { total: 5, perSource: {} },
  },
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/Describe the task/), {
    target: { value },
  });
}

function submit() {
  const form = document.querySelector("form");

  if (!form) {
    throw new Error("no form");
  }
  fireEvent.submit(form);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AssembledContextPanel", () => {
  it("disables the submit button until a query is entered", () => {
    render(<AssembledContextPanel owner="re-cinq" repo="lore" />);
    expect(screen.getByRole("button", { name: "Assemble" })).toBeDisabled();
    typeQuery("add auth");
    expect(screen.getByRole("button", { name: "Assemble" })).toBeEnabled();
  });

  it("fetches the context-preview endpoint with encoded query and selected template", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleResult));

    vi.stubGlobal("fetch", fetchMock);
    render(<AssembledContextPanel owner="re-cinq" repo="lore" />);

    typeQuery("add auth & roles");
    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "review" },
    });
    submit();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repos/re-cinq/lore/context-preview?query=add%20auth%20%26%20roles&template=review&debug=1",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("renders the assembled trace after a successful fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(sampleResult)),
    );
    render(<AssembledContextPanel owner="re-cinq" repo="lore" />);

    typeQuery("add auth");
    submit();
    await flush();

    expect(
      screen.getByText("1200 / 8000 tokens used · 6800 left"),
    ).toBeInTheDocument();
    expect(screen.getByText("Conventions")).toBeInTheDocument();
  });

  it("renders an HTTP error when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    render(<AssembledContextPanel owner="re-cinq" repo="lore" />);

    typeQuery("add auth");
    submit();
    await flush();

    expect(
      screen.getByText("Context unavailable: HTTP 403"),
    ).toBeInTheDocument();
  });

  it("renders the rejection message when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    render(<AssembledContextPanel owner="re-cinq" repo="lore" />);

    typeQuery("add auth");
    submit();
    await flush();

    expect(
      screen.getByText("Context unavailable: network down"),
    ).toBeInTheDocument();
  });

  it("clears a prior error after a subsequent successful assemble", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValue(jsonResponse(sampleResult));

    vi.stubGlobal("fetch", fetchMock);
    render(<AssembledContextPanel owner="re-cinq" repo="lore" />);

    typeQuery("add auth");
    submit();
    await flush();
    expect(
      screen.getByText("Context unavailable: HTTP 500"),
    ).toBeInTheDocument();

    submit();
    await flush();
    expect(screen.queryByText(/Context unavailable/)).not.toBeInTheDocument();
    expect(screen.getByText("Conventions")).toBeInTheDocument();
  });
});
