// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import SkillsPage from "./page";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const tdd = {
  name: "tdd",
  title: "Test driven",
  description: "",
  model: null,
  content: "x",
  enabled: true,
  projectId: null,
};

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

    expect(screen.getByRole("status")).toHaveTextContent(
      "Skills could not be loaded: database unavailable",
    );
  });

  it("links Add skill to /skills/new and Edit of tdd to /skills/tdd", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ skills: [tdd] })),
    );

    render(await SkillsPage({ searchParams: Promise.resolve({}) }));

    expect({
      add: screen.getByRole("link", { name: "Add skill" }).getAttribute("href"),
      edit: screen.getByRole("link", { name: "Edit" }).getAttribute("href"),
    }).toEqual({ add: "/skills/new", edit: "/skills/tdd" });
  });

  it("redirects ?edit=cli-design to /skills/cli-design", async () => {
    await expect(
      SkillsPage({ searchParams: Promise.resolve({ edit: "cli-design" }) }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("/skills/cli-design"),
    });
  });
});
