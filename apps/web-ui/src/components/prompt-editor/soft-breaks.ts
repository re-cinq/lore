import {
  StateField,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
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

interface SoftBreakState {
  /** Where the line breaks typed in this editor sit; they stay visible, as Enter promises. */
  typed: number[];
  decorations: DecorationSet;
}

function drawn(state: EditorState, typed: number[]): SoftBreakState {
  const soft = softBreaks(state.sliceDoc()).filter(
    (lineBreak) => !typed.includes(lineBreak.from),
  );

  return {
    typed,
    decorations: Decoration.set(
      soft.map((lineBreak) => SOFT_BREAK.range(lineBreak.from, lineBreak.to)),
    ),
  };
}

function typedAfter(typed: number[], transaction: Transaction): number[] {
  const kept = typed.map((position) => transaction.changes.mapPos(position));

  return transaction.isUserEvent("input")
    ? [...kept, ...insertedBreaks(transaction)]
    : kept;
}

function insertedBreaks(transaction: Transaction): number[] {
  const breaks: number[] = [];

  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const inserted = transaction.state.sliceDoc(fromB, toB);

    [...inserted].forEach((character, index) => {
      if (character === "\n") {
        breaks.push(fromB + index);
      }
    });
  });

  return breaks;
}

/** A paragraph's wrapping line breaks drawn as spaces, in the paragraph being edited too; a line break typed here stays a line. */
export const softBreakPreview = StateField.define<SoftBreakState>({
  create: (state) => drawn(state, []),
  update: (value, transaction) =>
    transaction.docChanged
      ? drawn(transaction.state, typedAfter(value.typed, transaction))
      : value,
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});
