// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import SkillsPage from "./page";

describe("SkillsPage", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "http://api:3000";
  });

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

    const ui = await SkillsPage({ searchParams: Promise.resolve({}) });

    render(ui);

    expect(screen.getByText("Test Skill Title")).toBeInTheDocument();
  });

  it("shows that skills could not be loaded when the API answers 500", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "database unavailable" }), {
        status: 500,
      }),
    );

    const ui = await SkillsPage({ searchParams: Promise.resolve({}) });

    render(ui);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Skills could not be loaded: database unavailable",
    );
  });
});
