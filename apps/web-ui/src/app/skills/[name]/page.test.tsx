// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { render, screen, cleanup } from "@testing-library/react";

import EditSkillPage from "./page";

const skill = {
  name: "tdd",
  title: "Test driven",
  description: "",
  model: null,
  content: "stored",
  enabled: true,
  projectId: null,
};

const answerWith = (skills: object[]) =>
  vi
    .spyOn(global, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ skills })));

describe("EditSkillPage", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "http://api:3000";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("answers not found for the name ghost when the API lists only tdd", async () => {
    answerWith([skill]);

    await expect(
      EditSkillPage({ params: Promise.resolve({ name: "ghost" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("renders tdd with its title and a read-only name", async () => {
    answerWith([skill]);

    render(await EditSkillPage({ params: Promise.resolve({ name: "tdd" }) }));

    expect({
      name: screen.getByLabelText("Name"),
      title: (screen.getByLabelText("Title") as HTMLInputElement).value,
    }).toMatchObject({
      name: expect.objectContaining({ value: "tdd", readOnly: true }),
      title: "Test driven",
    });
  });

  it("shows the API failure instead of a form when the API answers 500", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "database unavailable" }), {
        status: 500,
      }),
    );

    render(await EditSkillPage({ params: Promise.resolve({ name: "tdd" }) }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Skills could not be loaded: database unavailable",
    );
  });
});
