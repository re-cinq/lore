import { EditorView, WidgetType } from "@codemirror/view";
import { inlineMarks, type InlineMark } from "./inline-marks";
import type { Alignment, Table } from "./tables";

const INLINE_TAGS: Record<InlineMark["kind"], string> = {
  bold: "strong",
  italic: "em",
  code: "code",
  link: "span",
};

/** A pipe table drawn as an HTML table; a press on it puts the cursor at `from`, where the table starts, which brings its text back for editing. */
export class TableWidget extends WidgetType {
  constructor(
    readonly table: Table,
    readonly from: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return (
      other.from === this.from &&
      JSON.stringify(other.table) === JSON.stringify(this.table)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("table");

    element.className = "cm-prompt-table";
    element.append(
      section("thead", "th", [this.table.header], this.table.align),
      section("tbody", "td", this.table.rows, this.table.align),
    );
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });

    return element;
  }
}

function section(
  tag: "thead" | "tbody",
  cellTag: "th" | "td",
  rows: string[][],
  align: Alignment[],
): HTMLElement {
  const element = document.createElement(tag);

  element.append(
    ...rows.map((cells) => {
      const row = document.createElement("tr");

      row.append(
        ...cells.map((text, column) => cell(cellTag, text, align[column])),
      );

      return row;
    }),
  );

  return element;
}

function cell(tag: "th" | "td", text: string, align: Alignment): HTMLElement {
  const element = document.createElement(tag);

  element.append(...inlineNodes(text));

  if (align) {
    element.style.textAlign = align;
  }

  return element;
}

// The text with its top-level inline marks drawn; marks inside a mark stay plain text.
function inlineNodes(text: string): Node[] {
  const nodes: Node[] = [];
  let cursor = 0;

  for (const mark of inlineMarks(text)) {
    if (mark.from < cursor) {
      continue;
    }
    const inner = document.createElement(INLINE_TAGS[mark.kind]);

    const [open, close] = mark.markup;

    inner.textContent = text.slice(open.to, close.from);
    nodes.push(document.createTextNode(text.slice(cursor, mark.from)), inner);
    cursor = mark.to;
  }

  return [...nodes, document.createTextNode(text.slice(cursor))];
}
