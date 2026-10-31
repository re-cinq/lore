import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";
import type { Range as DecorationRange } from "@codemirror/state";
import { collapsedMarkup, promptMarks, type PromptMark } from "./prompt-marks";

const COLLAPSE = Decoration.replace({});

/** Draws a prompt as the document it formats: titles, bold, marked placeholders and tags, the markup collapsed except where the cursor is. */
export const livePreview = ViewPlugin.define(
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
);

function previewOf(view: EditorView): DecorationSet {
  const { state } = view;
  const text = state.sliceDoc();
  const marks = promptMarks(text);
  // Unfocused, nothing is being edited, so every line reads as the document.
  const selection = view.hasFocus ? state.selection.main : null;

  return Decoration.set(
    inDrawingOrder([
      ...marks.map(markDecoration),
      ...collapsedMarkup(text, marks, selection).map((range) =>
        COLLAPSE.range(range.from, range.to),
      ),
    ]),
  );
}

// CodeMirror takes decorations by position, and at one position by the side each starts on.
function inDrawingOrder(
  ranges: DecorationRange<Decoration>[],
): DecorationRange<Decoration>[] {
  return [...ranges].sort(
    (a, b) => a.from - b.from || a.value.startSide - b.value.startSide,
  );
}

function markDecoration(mark: PromptMark): DecorationRange<Decoration> {
  if (mark.kind === "heading") {
    return Decoration.line({
      class: `cm-prompt-heading cm-prompt-heading-${mark.level}`,
    }).range(mark.from);
  }

  return Decoration.mark({ class: `cm-prompt-${mark.kind}` }).range(
    mark.from,
    mark.to,
  );
}
