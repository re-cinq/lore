// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import SkillsPage from "./page";

describe("SkillsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders a skill title returned by the API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          {
            name: "test-skill",
            title: "Test Skill Title",
            model: "claude-3-5-sonnet",
            content: "",
          },
        ],
      }),
    } as Response);

    const Component = SkillsPage as unknown as (
      props: any,
    ) => Promise<JSX.Element>;
    const ui = await Component({ searchParams: Promise.resolve({}) });

    render(ui);

    expect(screen.getByText("Test Skill Title")).toBeInTheDocument();
  });
});
