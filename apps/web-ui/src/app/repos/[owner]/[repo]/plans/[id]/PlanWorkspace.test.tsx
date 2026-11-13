// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";

vi.mock("./PlanEditorPanel", () => new Promise(() => {}));

const { default: PlanWorkspace } = await import("./PlanWorkspace");

describe("PlanWorkspace", () => {
  it("draws the editor's shape, named Opening the plan…, while the editor's code loads", () => {
    const props = {} as ComponentProps<typeof PlanWorkspace>;

    render(<PlanWorkspace {...props} />);

    expect(
      screen.queryByRole("status", { name: "Opening the plan…" }),
    ).not.toBeNull();
  });
});
