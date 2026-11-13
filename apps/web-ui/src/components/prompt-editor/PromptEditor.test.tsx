// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { readFileSync } from "node:fs";
import PromptEditor from "./PromptEditor";

const PROMPT =
  "## How you work\n\nRead {ticket_path}  then\n- write **one** test\n";

const RESOURCES_TABLE = [
  "| Resource | Load when... |",
  "|----------|-------------|",
  "| `testing-cli.md` | Writing **Vitest** tests |",
  "| `composability.md` | Designing pipe behavior |",
].join("\n");

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

  it("submits wrapped lines with their line breaks when verbatim", () => {
    const wrapped = "<!-- begin -->\n**Summary.** a\n**Usage:** b\n";
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue={wrapped} verbatim />
      </form>,
    );

    expect(submittedPrompt(container.querySelector("form")!)).toBe(wrapped);
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

  it("draws '```bash\\n# install\\nnpm ci\\n```' as four code lines with no fences and no heading while unfocused", () => {
    const { container } = render(
      <PromptEditor
        name="prompt"
        defaultValue={"```bash\n# install\nnpm ci\n```"}
        verbatim
      />,
    );

    expect({
      codeLines: [...container.querySelectorAll(".cm-prompt-code-line")].map(
        (line) => line.textContent,
      ),
      headings: container.querySelectorAll(".cm-prompt-heading").length,
    }).toEqual({ codeLines: ["", "# install", "npm ci", ""], headings: 0 });
  });

  it("draws the cli-design resources table as a table with its code and bold cells rendered while unfocused", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={RESOURCES_TABLE} verbatim />,
    );
    const table = container.querySelector("table.cm-prompt-table");

    expect({
      headers: [...(table?.querySelectorAll("th") ?? [])].map(
        (cell) => cell.textContent,
      ),
      rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.innerHTML),
      ),
      pipes: container.querySelector(".cm-content")?.textContent,
    }).toEqual({
      headers: ["Resource", "Load when..."],
      rows: [
        [
          "<code>testing-cli.md</code>",
          "Writing <strong>Vitest</strong> tests",
        ],
        ["<code>composability.md</code>", "Designing pipe behavior"],
      ],
      pipes: expect.not.stringContaining("|"),
    });
  });

  it("shows the four raw lines of the resources table in mono once the selection sits in it", async () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={RESOURCES_TABLE} verbatim />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    view.focus();
    view.dispatch({ selection: { anchor: 30 } });

    await waitFor(() =>
      expect({
        tables: container.querySelectorAll("table.cm-prompt-table").length,
        rawLines: [...container.querySelectorAll(".cm-prompt-table-line")].map(
          (line) => line.textContent,
        ),
      }).toEqual({ tables: 0, rawLines: RESOURCES_TABLE.split("\n") }),
    );
  });

  it("puts the cursor at the start of the table after a press on the rendered table, whose raw lines then show", async () => {
    const { container } = render(
      <PromptEditor
        name="prompt"
        defaultValue={`Intro\n\n${RESOURCES_TABLE}`}
        verbatim
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    container
      .querySelector("table.cm-prompt-table")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    await waitFor(() =>
      expect({
        cursor: view.state.selection.main.head,
        tables: container.querySelectorAll("table.cm-prompt-table").length,
        rawLines: container.querySelectorAll(".cm-prompt-table-line").length,
      }).toEqual({ cursor: 7, tables: 0, rawLines: 4 }),
    );
  });

  it("shows the fence lines again once the selection sits on a code line of the block", async () => {
    const { container } = render(
      <PromptEditor
        name="prompt"
        defaultValue={"Run:\n```bash\nnpm ci\n```"}
        verbatim
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    view.focus();
    view.dispatch({ selection: { anchor: 14 } });

    await waitFor(() =>
      expect(
        [...container.querySelectorAll(".cm-prompt-code-line")].map(
          (line) => line.textContent,
        ),
      ).toEqual(["```bash", "npm ci", "```"]),
    );
  });

  it("draws 'Run `npm ci` now' with 'npm ci' as inline code and its backticks collapsed", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue="Run `npm ci` now" />,
    );

    expect({
      code: container.querySelector(".cm-prompt-code")?.textContent,
      content: container.querySelector(".cm-content")?.textContent,
    }).toEqual({ code: "npm ci", content: "Run npm ci now" });
  });

  it("draws '- one' and '  1. two' as list items of depth 0 and 1 with their markers styled", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={"- one\n  1. two"} verbatim />,
    );

    expect({
      depths: [...container.querySelectorAll(".cm-prompt-list")].map((line) =>
        line.getAttribute("style"),
      ),
      markers: [...container.querySelectorAll(".cm-prompt-bullet")].map(
        (marker) => marker.textContent,
      ),
    }).toEqual({
      depths: ["--list-depth: 0;", "--list-depth: 1;"],
      markers: ["-", "1."],
    });
  });

  it("draws '> Note' as a quote without its '> '", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue="> Note" />,
    );

    expect(container.querySelector(".cm-prompt-quote")?.textContent).toBe(
      "Note",
    );
  });

  it("draws the italic 'this' and the link 'docs' with their markup collapsed", () => {
    const { container } = render(
      <PromptEditor
        name="prompt"
        defaultValue="*this* [docs](https://x.dev)"
      />,
    );

    expect({
      italic: container.querySelector(".cm-prompt-italic")?.textContent,
      link: container.querySelector(".cm-prompt-link")?.textContent,
      content: container.querySelector(".cm-content")?.textContent,
    }).toEqual({ italic: "this", link: "docs", content: "this docs" });
  });

  it("draws '---' as a rule line with no text", () => {
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={"Above\n\n---"} verbatim />,
    );

    expect(container.querySelector(".cm-prompt-rule")?.textContent).toBe("");
  });

  it("aligns the rendered columns of '|:--|:-:|--:|' left, center and right", () => {
    const { container } = render(
      <PromptEditor
        name="prompt"
        defaultValue={"| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |"}
        verbatim
      />,
    );

    expect(
      [...container.querySelectorAll("table.cm-prompt-table th")].map(
        (cell) => (cell as HTMLElement).style.textAlign,
      ),
    ).toEqual(["left", "center", "right"]);
  });

  it("submits the cli-design skill body byte for byte and draws its table", () => {
    const body = readFileSync(
      `${process.cwd()}/../../libs/shared/src/agent-defaults/skills/cli-design.md`,
      "utf8",
    ).replace(/^---\n[\s\S]*?\n---\n/, "");
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue={body} verbatim />
      </form>,
    );

    const fromFirstTable = render(
      <PromptEditor
        name="prompt"
        defaultValue={body.slice(body.indexOf("\n| "))}
        verbatim
      />,
    );

    expect({
      submitted: submittedPrompt(container.querySelector("form")!),
      tables:
        fromFirstTable.container.querySelectorAll("table.cm-prompt-table")
          .length > 0,
    }).toEqual({ submitted: body, tables: true });
  });

  it("draws the cli-design entry-point diagram fence as code lines, its box-drawing text unchanged", () => {
    const body = readFileSync(
      `${process.cwd()}/../../libs/shared/src/agent-defaults/skills/cli-design.md`,
      "utf8",
    );
    const diagram = body.slice(body.indexOf("```\nEntry point"));
    const { container } = render(
      <PromptEditor name="prompt" defaultValue={diagram} verbatim />,
    );

    expect(
      container.querySelector(".cm-prompt-code-line:nth-child(2)")?.textContent,
    ).toBe("Entry point (CLI main)              Your logic (handlers)");
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

  it("draws 'const' of a ts fence in a keyword token and submits the text byte for byte", () => {
    const fence = '```ts\nconst name = "lore"; // greet\n```';
    const { container } = render(
      <form>
        <PromptEditor name="prompt" defaultValue={fence} verbatim />
      </form>,
    );

    expect({
      keywords: [...container.querySelectorAll(".hljs-keyword")].map(
        (token) => token.textContent,
      ),
      submitted: submittedPrompt(container.querySelector("form")!),
    }).toEqual({ keywords: ["const"], submitted: fence });
  });
});
