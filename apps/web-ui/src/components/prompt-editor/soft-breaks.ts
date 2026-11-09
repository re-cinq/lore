import { StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { softBreaks } from "./prompt-marks";

class SpaceWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const space = document.createElement("span");

    space.textContent = " ";

    return space;
  }
}

const SOFT_BREAK = Decoration.replace({ widget: new SpaceWidget() });

function drawn(state: EditorState): DecorationSet {
  return Decoration.set(
    softBreaks(state.sliceDoc()).map((lineBreak) =>
      SOFT_BREAK.range(lineBreak.from, lineBreak.to),
    ),
  );
}

/** A paragraph's wrapping line breaks drawn as spaces, in the paragraph being edited too: as in markdown, a new paragraph takes a blank line. */
export const softBreakPreview = StateField.define<DecorationSet>({
  create: drawn,
  update: (decorations, transaction) =>
    transaction.docChanged ? drawn(transaction.state) : decorations,
  provide: (field) => EditorView.decorations.from(field),
});
