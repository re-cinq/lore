// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import SkillsPage from "./page";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

  it("Skills page offers Add skill and no inline form fields when no skills exist", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ skills: [] })),
    );

    render(await SkillsPage({ searchParams: Promise.resolve({}) }));

    expect({
      add: screen.getByRole("link", { name: "Add skill" }).getAttribute("href"),
      fields: screen.queryAllByRole("textbox").length,
    }).toEqual({ add: "/skills/new", fields: 0 });
  });
});
