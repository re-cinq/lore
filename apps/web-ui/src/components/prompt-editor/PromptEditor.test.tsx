// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { undo } from "@codemirror/commands";
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
});
