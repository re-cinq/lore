import { describe, it, expect } from "vitest";
import {
  collapsedMarkup,
  joinedParagraphs,
  promptMarks,
  softBreaks,
} from "./prompt-marks";

describe("promptMarks", () => {
  it("returns a level-2 heading over '## How you work' with its '## ' as markup", () => {
    expect(promptMarks("## How you work")).toEqual([
      {
        kind: "heading",
        level: 2,
        from: 0,
        to: 15,
        markup: [{ from: 0, to: 3 }],
      },
    ]);
  });

  it("returns bold over '**every**' in 'Read **every** line' with both '**' as markup", () => {
    expect(promptMarks("Read **every** line")).toEqual([
      {
        kind: "bold",
        from: 5,
        to: 14,
        markup: [
          { from: 5, to: 7 },
          { from: 12, to: 14 },
        ],
      },
    ]);
  });

  it("returns a placeholder over '{ticket_path}' and a tag over '<instructions>', hiding neither", () => {
    expect(promptMarks("Read {ticket_path} inside <instructions>")).toEqual([
      { kind: "placeholder", from: 5, to: 18, markup: [] },
      { kind: "tag", from: 26, to: 40, markup: [] },
    ]);
  });
});

describe("promptMarks over fenced code", () => {
  it("returns only a fence over '```bash\\n# install\\nnpm ci\\n```', the '# install' not a heading", () => {
    expect(
      promptMarks("```bash\n# install\nnpm ci\n```").filter(
        (mark) => mark.kind !== "token",
      ),
    ).toEqual([
      {
        kind: "fence",
        block: true,
        from: 0,
        to: 28,
        lineStarts: [0, 8, 18, 25],
        markup: [
          { from: 0, to: 7 },
          { from: 25, to: 28 },
        ],
      },
    ]);
  });

  it("returns a comment token over '# install' and a keyword token over 'const' in a bash and a ts fence, hiding nothing", () => {
    const text = "```bash\n# install\n```\n\n```ts\nconst a = 1;\n```";

    expect(
      promptMarks(text)
        .filter((mark) => mark.kind === "token")
        .map((mark) => ({ ...mark, text: text.slice(mark.from, mark.to) })),
    ).toEqual([
      {
        kind: "token",
        className: "hljs-comment",
        from: 8,
        to: 17,
        markup: [],
        text: "# install",
      },
      {
        kind: "token",
        className: "hljs-keyword",
        from: 29,
        to: 34,
        markup: [],
        text: "const",
      },
      {
        kind: "token",
        className: "hljs-number",
        from: 39,
        to: 40,
        markup: [],
        text: "1",
      },
    ]);
  });
});

describe("promptMarks over inline code", () => {
  it("returns only a code mark over '`**not bold** {x}`' with both backticks as markup", () => {
    expect(promptMarks("Run `**not bold** {x}` now")).toEqual([
      {
        kind: "code",
        from: 4,
        to: 22,
        markup: [
          { from: 4, to: 5 },
          { from: 21, to: 22 },
        ],
      },
    ]);
  });
});

describe("promptMarks over italics", () => {
  it("returns italics over '*this*' and '_that_' but not over snake_case_name or '**bold**'", () => {
    const text = "Use *this* or _that_, not snake_case_name or **bold**";

    expect(
      promptMarks(text).map(({ kind, from, to }) => ({ kind, from, to })),
    ).toEqual([
      { kind: "italic", from: 4, to: 10 },
      { kind: "italic", from: 14, to: 20 },
      { kind: "bold", from: 45, to: 53 },
    ]);
  });
});

describe("promptMarks over links", () => {
  it("returns a link over the text 'Stricli' with its brackets and '(https://x.dev/s)' as markup, none over an image", () => {
    expect(
      promptMarks("See [Stricli](https://x.dev/s) and ![logo](l.png)"),
    ).toEqual([
      {
        kind: "link",
        from: 4,
        to: 30,
        markup: [
          { from: 4, to: 5 },
          { from: 12, to: 30 },
        ],
      },
    ]);
  });
});

describe("promptMarks over list items", () => {
  it("returns list items for '- one', '  * nested' and '1. first', each with its marker and depth, hiding nothing", () => {
    expect(promptMarks("- one\n  * nested\n1. first")).toEqual([
      {
        kind: "list",
        from: 0,
        to: 5,
        depth: 0,
        marker: { from: 0, to: 1 },
        markup: [],
      },
      {
        kind: "list",
        from: 6,
        to: 16,
        depth: 1,
        marker: { from: 8, to: 9 },
        markup: [],
      },
      {
        kind: "list",
        from: 17,
        to: 25,
        depth: 0,
        marker: { from: 17, to: 19 },
        markup: [],
      },
    ]);
  });
});

describe("promptMarks over quotes and rules", () => {
  it("returns a quote over '> Note' with '> ' as markup and a rule over '---' with the whole line as markup", () => {
    expect(promptMarks("> Note\n\n---")).toEqual([
      { kind: "quote", from: 0, to: 6, markup: [{ from: 0, to: 2 }] },
      { kind: "rule", from: 8, to: 11, markup: [{ from: 8, to: 11 }] },
    ]);
  });
});

describe("promptMarks over tables", () => {
  const RESOURCES = [
    "| Resource | Load when... |",
    "|----------|-------------|",
    "| `testing-cli.md` | Writing Vitest tests for CLI behavior |",
    "| `stream-contracts.md` | Understanding Node.js buffering |",
  ].join("\n");

  it("returns one table over the cli-design resources table, its whole range as markup and no code marks inside", () => {
    expect(promptMarks(`The table:\n\n${RESOURCES}\n\nAfter`)).toEqual([
      {
        kind: "table",
        block: true,
        from: 12,
        to: 12 + RESOURCES.length,
        lineStarts: [12, 40, 67, 128],
        markup: [{ from: 12, to: 12 + RESOURCES.length }],
        table: {
          header: ["Resource", "Load when..."],
          align: [null, null],
          rows: [
            ["`testing-cli.md`", "Writing Vitest tests for CLI behavior"],
            ["`stream-contracts.md`", "Understanding Node.js buffering"],
          ],
        },
      },
    ]);
  });
});

describe("promptMarks over table alignment", () => {
  it("reads left, center and right from '|:--|:-:|--:|' and an escaped pipe stays in its cell", () => {
    const marks = promptMarks(
      "Name | Qty | Note\n:-- | :-: | --:\nx | 2 | a\\|b",
    );

    expect(marks).toMatchObject([
      {
        kind: "table",
        table: {
          header: ["Name", "Qty", "Note"],
          align: ["left", "center", "right"],
          rows: [["x", "2", "a|b"]],
        },
      },
    ]);
  });
});

describe("collapsedMarkup", () => {
  it("hides the first heading's '## ' and shows the second's when the cursor sits on the second line", () => {
    const text = "## Plan\n## Build";

    expect(
      collapsedMarkup(text, promptMarks(text), { from: 12, to: 12 }),
    ).toEqual([{ from: 0, to: 3 }]);
  });

  it("shows the markup of every line a selection spans", () => {
    const text = "## Plan\n**Read** it\n## Build";

    expect(
      collapsedMarkup(text, promptMarks(text), { from: 2, to: 10 }),
    ).toEqual([{ from: 20, to: 23 }]);
  });

  it("hides both fence lines with the cursor outside the block and shows them with the cursor on a code line in the middle", () => {
    const text = "Run:\n```sh\nnpm ci\nnpm test\n```\nDone";
    const fences = [
      { from: 5, to: 10 },
      { from: 27, to: 30 },
    ];

    expect([
      collapsedMarkup(text, promptMarks(text), { from: 1, to: 1 }),
      collapsedMarkup(text, promptMarks(text), { from: 18, to: 18 }),
    ]).toEqual([fences, []]);
  });

  it("hides every heading's '## ' when nothing is being edited", () => {
    const text = "## Plan\n## Build";

    expect(collapsedMarkup(text, promptMarks(text), null)).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });
});

describe("softBreaks", () => {
  it("finds the break in 'Read the\\nticket' as soft", () => {
    expect(softBreaks("Read the\nticket")).toEqual([{ from: 8, to: 9 }]);
  });

  it("keeps the break before '- item' hard", () => {
    expect(softBreaks("Read this\n- item")).toEqual([]);
  });

  it("keeps the break after '## Title' hard", () => {
    expect(softBreaks("## Title\nRead this")).toEqual([]);
  });

  it("keeps the breaks around a blank line hard", () => {
    expect(softBreaks("One\n\nTwo")).toEqual([]);
  });

  it("keeps breaks inside a fenced code block hard", () => {
    expect(softBreaks("```\nnpm ci\nnpm test\n```")).toEqual([]);
  });

  it("keeps the breaks of a table written without outer pipes hard", () => {
    expect(softBreaks("Name | Qty\n--- | ---\nx | 2")).toEqual([]);
  });

  it("keeps the breaks inside a ~~~ fenced block and around a '---' rule hard", () => {
    expect(softBreaks("~~~\nnpm ci\nnpm test\n~~~\nText\n---\nMore")).toEqual(
      [],
    );
  });

  it("joins 'One\\ntwo' and 'Three\\nfour', the paragraph being edited too", () => {
    expect(softBreaks("One\ntwo\n\nThree\nfour")).toEqual([
      { from: 3, to: 4 },
      { from: 14, to: 15 },
    ]);
  });
});

describe("joinedParagraphs", () => {
  it("returns 'Read the ticket\\n\\n- one\\n- two' for 'Read the\\nticket\\n\\n- one\\n- two'", () => {
    expect(joinedParagraphs("Read the\nticket\n\n- one\n- two")).toBe(
      "Read the ticket\n\n- one\n- two",
    );
  });

  it("joins 'Read\\nthe' after an emoji of two UTF-16 units", () => {
    expect(joinedParagraphs("Hi \u{1F642} Read\nthe")).toBe(
      "Hi \u{1F642} Read the",
    );
  });

  it("returns 'Read the ticket' for a form-saved 'Read the\\r\\nticket'", () => {
    expect(joinedParagraphs("Read the\r\nticket")).toBe("Read the ticket");
  });
});
