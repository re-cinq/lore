// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { readFileSync } from "node:fs";
import PromptEditor from "./PromptEditor";

const PROMPT =
  "## How you work\n\nRead {ticket_path}  then\n- write **one** test\n";

function submittedPrompt(form: HTMLFormElement): FormDataEntryValue | null {
  return new FormData(form).get("prompt");
}

describe("PromptEditor", () => {
  it("submits the prompt it was given unchanged under the prompt field", () => {
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue={PROMPT} />
      </form>,
    );

    expect(submittedPrompt(container.querySelector("form")!)).toBe(PROMPT);
  });

  it("submits 'Read the ticket' after it is typed into an empty editor", () => {
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue="" />
      </form>,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    view.dispatch({ changes: { from: 0, insert: "Read the ticket" } });

    expect(submittedPrompt(container.querySelector("form")!)).toBe(
      "Read the ticket",
    );
  });

  it("draws '## How you work' as a level-2 title without its '## ' while unfocused", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={PROMPT} />,
    );

    expect({
      title: container.querySelector(".cm-prompt-heading-2")?.textContent,
      content: container.querySelector(".cm-content")?.textContent,
    }).toMatchObject({
      title: "How you work",
      content: expect.not.stringContaining("## "),
    });
  });

  it("marks {ticket_path} as a placeholder", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={PROMPT} />,
    );

    expect(container.querySelector(".cm-prompt-placeholder")?.textContent).toBe(
      "{ticket_path}",
    );
  });

  it("shows the inherited prompt as the placeholder of an empty editor", () => {
    const { container } = render(
      <PromptEditor
        name="prompt"
        defaultValue=""
        placeholder="Review the pull request"
      />,
    );

    expect(container.querySelector(".cm-placeholder")?.textContent).toBe(
      "Review the pull request",
    );
  });

  it("wraps long lines so a paragraph reads as a paragraph", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={PROMPT} />,
    );

    expect(
      container
        .querySelector(".cm-content")
        ?.classList.contains("cm-lineWrapping"),
    ).toBe(true);
  });

  it("submits 'Read' again after typing ' the ticket' and undoing it", () => {
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue="Read" />
      </form>,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    view.dispatch({ changes: { from: 4, insert: " the ticket" } });
    undo(view);

    expect(submittedPrompt(container.querySelector("form")!)).toBe("Read");
  });

  it("submits 'Read\\n' after Enter is pressed at the end of 'Read'", () => {
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue="Read" />
      </form>,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    view.dispatch({ selection: { anchor: 4 } });
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "Enter" }),
      "editor",
    );

    expect(submittedPrompt(container.querySelector("form")!)).toBe("Read\n");
  });

  it("draws 'Read the\\nticket' as one line", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={"Read the\nticket"} />,
    );

    expect(container.querySelectorAll(".cm-line")).toHaveLength(1);
  });

  it("submits 'Read the ticket' for a stored 'Read the\\nticket'", () => {
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue={"Read the\nticket"} />
      </form>,
    );

    expect(submittedPrompt(container.querySelector("form")!)).toBe(
      "Read the ticket",
    );
  });

  it("keeps '- one\\n- two' on two lines", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={"- one\n- two"} />,
    );

    expect(container.querySelectorAll(".cm-line")).toHaveLength(2);
  });

  it("draws 'Read the ticket' on two lines after Enter is pressed after 'Read'", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue="Read the ticket" />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    view.dispatch({ selection: { anchor: 4 } });
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "Enter" }),
      "editor",
    );

    expect(container.querySelectorAll(".cm-line")).toHaveLength(2);
  });

  it("gives the caret the text colour rather than CodeMirror's black", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue="Read" />,
    );

    expect(
      getComputedStyle(container.querySelector(".cm-content")!).caretColor,
    ).toBe("var(--text)");
  });

  it("draws each block of the shipped code-review prompt as one line", () => {
    const body = readFileSync(
      `${process.cwd()}/../../libs/shared/src/agent-defaults/code-review.md`,
      "utf8",
    ).replace(/^---\n[\s\S]*?\n---\n/, "");
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={body} />,
    );
    const lines = [...container.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "")
      .filter((text) => text.trim() !== "");

    expect(lines.slice(1, 4)).toEqual([
      expect.stringContaining("Read the diff and changed files"),
      expect.stringContaining("the PR title, the spec sections it touches"),
      expect.stringContaining("Read the change as its user"),
    ]);
  });
});
