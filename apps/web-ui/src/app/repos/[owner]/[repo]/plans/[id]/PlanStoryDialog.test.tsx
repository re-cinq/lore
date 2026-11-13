// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PlanStory } from "@/lib/api/plans";
import PlanStoryDialog from "./PlanStoryDialog";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const LINKED: PlanStory = {
  issueNumber: 123,
  issueUrl: "https://github.com/re-cinq/lore/issues/123",
};
const UNLINKED: PlanStory = { issueNumber: null, issueUrl: null };

const save = vi.fn(async (_text: string): Promise<{ error?: string }> => ({}));
const remove = vi.fn(async (): Promise<{ error?: string }> => ({}));
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function openDialog(story: PlanStory | null) {
  render(
    <PlanStoryDialog
      repo="re-cinq/lore"
      story={story}
      save={save}
      remove={remove}
      onClose={onClose}
    />,
  );
}

const field = () =>
  screen.getByRole("textbox", { name: "Issue URL or number" });

const typeStory = (text: string) =>
  fireEvent.change(field(), { target: { value: text } });

const press = (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

describe("PlanStoryDialog", () => {
  it("prefills 123 for a plan linked to #123", () => {
    openDialog(LINKED);

    expect((field() as HTMLInputElement).value).toBe("123");
  });

  it("prefills nothing for a plan with no story", () => {
    openDialog(UNLINKED);

    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("says the planning agent reads the story from the next planning run on", () => {
    openDialog(LINKED);

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The planning agent reads it from the next planning run on.",
    );
  });

  it("saves 456 typed as an issue URL of the repo, refreshes the page and closes", async () => {
    openDialog(LINKED);
    typeStory("https://github.com/re-cinq/lore/issues/456");
    await press("Save");

    expect({
      saved: save.mock.calls,
      refreshed: refresh.mock.calls.length,
      closed: onClose.mock.calls.length,
    }).toEqual({
      saved: [["https://github.com/re-cinq/lore/issues/456"]],
      refreshed: 1,
      closed: 1,
    });
  });

  it("refuses an issue of another repo and keeps Save off", () => {
    openDialog(LINKED);
    typeStory("https://github.com/other/repo/issues/42");

    const hintId = field().getAttribute("aria-describedby") ?? "";

    expect({
      hint: document.getElementById(hintId)?.textContent,
      invalid: field().getAttribute("aria-invalid"),
      saveOff: screen
        .getByRole("button", { name: "Save" })
        .hasAttribute("disabled"),
    }).toEqual({
      hint: "The user story must be an issue of re-cinq/lore.",
      invalid: "true",
      saveOff: true,
    });
  });

  it("keeps Save off while the field is blank", () => {
    openDialog(UNLINKED);

    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("offers Remove link for a plan linked to #123", () => {
    openDialog(LINKED);

    expect(
      screen.getByRole("button", { name: "Remove link" }),
    ).toBeInTheDocument();
  });

  it("offers no Remove link for a plan with no story", () => {
    openDialog(UNLINKED);

    expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
  });

  it("removes the link, refreshes the page and closes", async () => {
    openDialog(LINKED);
    await press("Remove link");

    expect({
      removed: remove.mock.calls.length,
      refreshed: refresh.mock.calls.length,
      closed: onClose.mock.calls.length,
    }).toEqual({ removed: 1, refreshed: 1, closed: 1 });
  });

  it("stays open and says why when the save is refused", async () => {
    save.mockResolvedValueOnce({ error: "Plan not found." });
    openDialog(LINKED);
    typeStory("456");
    await press("Save");

    expect({
      reason: screen.getByText("Plan not found.").textContent,
      closed: onClose.mock.calls.length,
      refreshed: refresh.mock.calls.length,
    }).toEqual({ reason: "Plan not found.", closed: 0, refreshed: 0 });
  });

  it("closes without saving when cancelled", () => {
    openDialog(LINKED);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect({
      saved: save.mock.calls.length,
      closed: onClose.mock.calls.length,
    }).toEqual({ saved: 0, closed: 1 });
  });
});
