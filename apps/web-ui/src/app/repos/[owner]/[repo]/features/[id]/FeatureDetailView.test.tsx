// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeatureDetailView from "./FeatureDetailView";
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

const definition: AssemblyLineDefinition = {
  name: "feature-planning",
  description: "Plans a feature",
  version: 1,
  entry: "analyze",
  exit: "push",
  nodes: [],
  edges: [],
};

const feature = (
  over: Partial<FeatureWithIterations> = {},
): FeatureWithIterations => ({
  id: "f1",
  repo: "o/r",
  title: "Ship the thing",
  slug: "ship-the-thing",
  path: "specs/ship-the-thing/spec.md",
  original_prompt: "",
  status: "implemented",
  current_iteration: 1,
  draft_spec_md: null,
  parent_feature_id: null,
  spec_path: "specs/ship-the-thing/spec.md",
  spec_pr_url: "https://github.com/o/r/pull/1",
  spec_pr_number: 1,
  issue_number: null,
  issue_url: null,
  created_by: "user",
  created_at: "2026-06-11T10:00:00Z",
  updated_at: "2026-06-11T10:00:00Z",
  iterations: [],
  ...over,
});

const noopAsync = async () => {};
const baseProps = {
  owner: "o",
  repo: "r",
  timeoutMinutes: 15,
  decomposition: { stories: [], total: 0 },
  refine: async (_userAnswers: SectionAnswers, _fromIteration?: number) => {},
  onCreateSpecFile: async (_userAnswers: SectionAnswers) => {},
  split: async (_title: string, _prompt: string) => {},
  del: noopAsync,
};

describe("FeatureDetailView", () => {
  it("renders the assembly line panel when there is no live run", () => {
    render(
      <FeatureDetailView
        feature={feature()}
        definition={definition}
        {...baseProps}
      />,
    );

    expect(
      screen.getByText("This feature's assembly line"),
    ).toBeInTheDocument();
  });

  it("shows the original prompt when the feature carries one", () => {
    render(
      <FeatureDetailView
        feature={feature({ original_prompt: "Add dark mode" })}
        {...baseProps}
      />,
    );

    expect(screen.getByText("Add dark mode")).toBeInTheDocument();
  });

  it("omits the prompt card when the feature has none", () => {
    render(
      <FeatureDetailView
        feature={feature({ original_prompt: "" })}
        {...baseProps}
      />,
    );

    expect(screen.queryByText("Your prompt")).toBeNull();
  });

  it("asks for confirmation before deleting, and cancel backs out", async () => {
    const user = userEvent.setup();

    render(<FeatureDetailView feature={feature()} {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "Delete feature" }));

    expect(
      screen.getByText("Delete “Ship the thing” and all its rounds?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Delete feature" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/and all its rounds\?/)).toBeNull();
  });
});
