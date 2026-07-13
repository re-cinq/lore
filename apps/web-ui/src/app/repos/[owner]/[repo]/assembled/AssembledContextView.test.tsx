import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssembledContextView, {
  type AssembledContextViewProps,
} from "./AssembledContextView";
import type { AssemblyTrace } from "./trace-types";

const trace = (over: Partial<AssemblyTrace> = {}): AssemblyTrace => ({
  query: "add auth",
  template: "implementation",
  effectiveBudget: 8000,
  crossRepo: false,
  templateSections: [],
  sections: [
    {
      header: "Architecture Decisions",
      source: "adrs",
      priority: 1,
      status: "ok",
      allocatedBudget: 3000,
      rawTokens: 640,
      finalTokens: 640,
      truncated: false,
      included: true,
      items: [
        {
          text: "## Decision\n\nuse X",
          tokens: 640,
          source_path: "adrs/ADR-016.md",
          content_type: "adr",
          score: 0.83,
          ingested_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    },
    {
      header: "Directory Rules",
      source: "rules",
      priority: 1,
      status: "no-match",
      allocatedBudget: 0,
      rawTokens: 0,
      finalTokens: 0,
      truncated: false,
      included: false,
      omitReason: "no rule matched the query",
      items: [],
    },
  ],
  budget: { total: 8000, used: 640, leftover: 7360 },
  freshness: { state: "fresh", message: "" },
  timingsMs: { total: 42, perSource: { adrs: 10 } },
  ...over,
});

const baseProps = (
  over: Partial<AssembledContextViewProps> = {},
): AssembledContextViewProps => ({
  owner: "re-cinq",
  repo: "lore",
  query: "add auth",
  template: "implementation",
  templates: ["default", "implementation", "review", "research"],
  result: null,
  loading: false,
  error: null,
  onQueryChange: vi.fn(),
  onTemplateChange: vi.fn(),
  onSubmit: vi.fn(),
  ...over,
});

function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  enforceTrue(form, new Error("no form"));
  fireEvent.submit(form);
}

describe("AssembledContextView — form + state", () => {
  it("renders the heading and the prompt-debug help popover trigger", () => {
    render(<AssembledContextView {...baseProps()} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Assembled Context" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Prompt debug view" }),
    ).toBeInTheDocument();
  });

  it("renders one template option per templates entry, with the current one selected", () => {
    render(<AssembledContextView {...baseProps({ template: "review" })} />);
    const select = screen.getByLabelText("Template") as HTMLSelectElement;
    expect(select.value).toBe("review");
    expect(select.querySelectorAll("option")).toHaveLength(4);
  });

  it("pushes query and template edits up via callbacks", () => {
    const onQueryChange = vi.fn();
    const onTemplateChange = vi.fn();
    render(
      <AssembledContextView
        {...baseProps({ query: "", onQueryChange, onTemplateChange })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Describe the task/), {
      target: { value: "fix bug" },
    });
    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "research" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("fix bug");
    expect(onTemplateChange).toHaveBeenCalledWith("research");
  });

  it("disables submit when blank/whitespace or loading, and fires onSubmit otherwise", () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(
      <AssembledContextView {...baseProps({ query: "   " })} />,
    );
    expect(screen.getByRole("button", { name: "Assemble" })).toBeDisabled();
    rerender(<AssembledContextView {...baseProps({ loading: true })} />);
    expect(screen.getByRole("button", { name: "Assembling…" })).toBeDisabled();
    rerender(<AssembledContextView {...baseProps({ onSubmit })} />);
    submitForm(container);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders loading and error states", () => {
    const { rerender } = render(
      <AssembledContextView {...baseProps({ loading: true })} />,
    );
    expect(screen.getByText("Assembling context…")).toBeInTheDocument();
    rerender(<AssembledContextView {...baseProps({ error: "HTTP 500" })} />);
    expect(
      screen.getByText("Context unavailable: HTTP 500"),
    ).toBeInTheDocument();
  });

  it("renders the empty state when a result has null text and no trace", () => {
    render(
      <AssembledContextView
        {...baseProps({ result: { text: null, sections: [] } })}
      />,
    );
    expect(
      screen.getByText(
        "No context assembled — the repo may not be onboarded or ingested yet.",
      ),
    ).toBeInTheDocument();
  });
});

describe("AssembledContextView — assembly trace", () => {
  const withTrace = (over: Partial<AssemblyTrace> = {}) =>
    baseProps({ result: { text: "<context></context>", trace: trace(over) } });

  it("renders the budget summary from the trace", () => {
    render(<AssembledContextView {...withTrace()} />);
    expect(
      screen.getByText("640 / 8000 tokens used · 7360 left"),
    ).toBeInTheDocument();
  });

  it("renders an included source card and an omitted one with its reason", () => {
    render(<AssembledContextView {...withTrace()} />);
    expect(screen.getByText("Architecture Decisions")).toBeInTheDocument();
    expect(screen.getByText("included")).toBeInTheDocument();
    expect(
      screen.getByText("omitted · no rule matched the query"),
    ).toBeInTheDocument();
  });

  it("links each contributing document to its context detail page", () => {
    render(<AssembledContextView {...withTrace()} />);
    const link = screen.getByRole("link", { name: "adrs/ADR-016.md" });
    expect(link).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore/context/adrs%2FADR-016.md",
    );
  });

  it("renders the assembled prompt as a nested context/section/document tag tree", () => {
    render(<AssembledContextView {...withTrace()} />);
    expect(screen.getByText("context")).toBeInTheDocument();
    expect(screen.getByText("section")).toBeInTheDocument();
    expect(screen.getByText("document")).toBeInTheDocument();
    // document body renders as markdown (the chunk's own heading, contained)
    expect(
      screen.getByRole("heading", { level: 2, name: "Decision" }),
    ).toBeInTheDocument();
  });

  it("toggles the prompt body between rendered markdown and raw text", () => {
    render(<AssembledContextView {...withTrace()} />);
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByText(/## Decision/)).toBeInTheDocument();
  });
});
