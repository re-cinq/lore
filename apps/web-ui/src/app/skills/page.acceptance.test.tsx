// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import SkillsPage from "./page";

describe("Skills Management UI", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "http://api:3000";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("Skills page lists org-level skill definitions fetched from the API with options to edit and delete", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          {
            name: "my-custom-skill",
            title: "Dynamic Skill API",
            model: "claude-3-5-sonnet",
            content: "hello",
          },
        ],
      }),
    } as Response);

    const ui = await SkillsPage({ searchParams: Promise.resolve({}) });

    render(ui);

    expect(await screen.findByText("Dynamic Skill API")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove|delete/i }),
    ).toBeInTheDocument();
  });

  it("Skill definitions offer options for setting models, titles, and content", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ skills: [] })),
    );

    const ui = await SkillsPage({ searchParams: Promise.resolve({}) });

    render(ui);

    const createBtn =
      screen.queryByRole("button", { name: /create|new/i }) ||
      screen.queryByRole("link", { name: /create|new/i });

    if (createBtn) {
      fireEvent.click(createBtn);
    }

    expect(await screen.findByLabelText(/model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/content|skill\.md/i)).toBeInTheDocument();
  });
});
