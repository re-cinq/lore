import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";
import type { Range as DecorationRange } from "@codemirror/state";
import { collapsedMarkup, type PromptMark } from "./prompt-marks";
import { marksField } from "./marks-field";
import { tablePreview } from "./table-preview";

type Drawn = DecorationRange<Decoration>[];
type MarkOfKind<Kind extends PromptMark["kind"]> = Extract<
  PromptMark,
  { kind: Kind }
>;

const COLLAPSE = Decoration.replace({});

/** Draws a prompt as the document it formats: titles, code, lists, quotes, links, marked placeholders and tags, the markup collapsed except where the cursor is. A table is drawn as a table by `tablePreview`, which needs block decorations; the rest are inline and line decorations of a view plugin. */
export const livePreview = [
  marksField,
  tablePreview,
  ViewPlugin.define(
    (view) => {
      const plugin = {
        decorations: previewOf(view),
        update(update: {
          view: EditorView;
          docChanged: boolean;
          selectionSet: boolean;
          focusChanged: boolean;
        }) {
          if (update.docChanged || update.selectionSet || update.focusChanged) {
            plugin.decorations = previewOf(update.view);
          }
        },
      };

      return plugin;
    },
    { decorations: (plugin) => plugin.decorations },
  ),
];

function previewOf(view: EditorView): DecorationSet {
  const { state } = view;
  const marks = state.field(marksField);
  // Unfocused, nothing is being edited, so every line reads as the document.
  const selection = view.hasFocus ? state.selection.main : null;
  const collapsed = collapsedMarkup(state.sliceDoc(), marks, selection);
  const tableStarts = new Set(
    marks.filter((mark) => mark.kind === "table").map((mark) => mark.from),
  );

  return Decoration.set(
    inDrawingOrder([
      ...marks.flatMap(draw),
      ...tableLinesBeingEdited(marks, collapsed),
      // A collapsed table is the widget's to draw, not a collapsed range.
      ...collapsed
        .filter((range) => !tableStarts.has(range.from))
        .map((range) => COLLAPSE.range(range.from, range.to)),
    ]),
  );
}

// CodeMirror takes decorations by position, and at one position by the side each starts on.
function inDrawingOrder(ranges: Drawn): Drawn {
  return [...ranges].sort(
    (a, b) => a.from - b.from || a.value.startSide - b.value.startSide,
  );
}

// A table the selection touches is edited as the text it is, in a mono font.
function tableLinesBeingEdited(
  marks: PromptMark[],
  collapsed: { from: number }[],
): Drawn {
  const drawnFroms = new Set(collapsed.map((range) => range.from));

  return marks
    .flatMap((mark) =>
      mark.kind === "table" && !drawnFroms.has(mark.from) ? [mark] : [],
    )
    .flatMap((table) =>
      table.lineStarts.map((start) =>
        lineDecoration(start, "cm-prompt-table-line"),
      ),
    );
}

const DRAWINGS: {
  [Kind in PromptMark["kind"]]: (mark: MarkOfKind<Kind>) => Drawn;
} = {
  heading: (mark) => [
    lineDecoration(
      mark.from,
      `cm-prompt-heading cm-prompt-heading-${mark.level}`,
    ),
  ],
  fence: (mark) =>
    mark.lineStarts.map((start, index) =>
      lineDecoration(start, fenceLineClass(index, mark.lineStarts.length)),
    ),
  table: () => [],
  list: (mark) => [
    lineDecoration(mark.from, "cm-prompt-list", `--list-depth: ${mark.depth}`),
    markDecoration("bullet", mark.marker),
  ],
  quote: (mark) => [lineDecoration(mark.from, "cm-prompt-quote")],
  rule: (mark) => [lineDecoration(mark.from, "cm-prompt-rule")],
  bold: (mark) => [markDecoration("bold", mark)],
  italic: (mark) => [markDecoration("italic", mark)],
  code: (mark) => [markDecoration("code", mark)],
  link: (mark) => [markDecoration("link", mark)],
  placeholder: (mark) => [markDecoration("placeholder", mark)],
  tag: (mark) => [markDecoration("tag", mark)],
  token: (mark) => [
    Decoration.mark({ class: mark.className }).range(mark.from, mark.to),
  ],
};

function draw<Kind extends PromptMark["kind"]>(mark: MarkOfKind<Kind>): Drawn {
  return DRAWINGS[mark.kind as Kind](mark);
}

function markDecoration(
  name: string,
  { from, to }: { from: number; to: number },
): DecorationRange<Decoration> {
  return Decoration.mark({ class: `cm-prompt-${name}` }).range(from, to);
}

function lineDecoration(
  from: number,
  className: string,
  style?: string,
): DecorationRange<Decoration> {
  return Decoration.line({
    class: className,
    attributes: style ? { style } : undefined,
  }).range(from);
}

function fenceLineClass(index: number, lineCount: number): string {
  const edges = [
    ...(index === 0 ? ["cm-prompt-code-first"] : []),
    ...(index === lineCount - 1 ? ["cm-prompt-code-last"] : []),
  ];

  return ["cm-prompt-code-line", ...edges].join(" ");
}
