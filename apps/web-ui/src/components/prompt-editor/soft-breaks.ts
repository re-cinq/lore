import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { softBreaks, type Range } from "./prompt-marks";

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
const focusChanged = StateEffect.define<boolean>();

interface SoftBreakState {
  focused: boolean;
  decorations: DecorationSet;
}

function drawn(state: EditorState, selection: Range | null): DecorationSet {
  return Decoration.set(
    softBreaks(state.sliceDoc(), selection).map((lineBreak) =>
      SOFT_BREAK.range(lineBreak.from, lineBreak.to),
    ),
  );
}

function focusOf(value: SoftBreakState, transaction: Transaction): boolean {
  const focus = transaction.effects.find((effect) => effect.is(focusChanged));

  return focus?.is(focusChanged) ? focus.value : value.focused;
}

function redrawn(
  { focused }: Pick<SoftBreakState, "focused">,
  state: EditorState,
): SoftBreakState {
  const { main } = state.selection;

  return { focused, decorations: drawn(state, focused ? main : null) };
}

const softBreakField = StateField.define<SoftBreakState>({
  create: (state) => ({ focused: false, decorations: drawn(state, null) }),
  update(value, transaction) {
    const focused = focusOf(value, transaction);
    const changed =
      focused !== value.focused ||
      transaction.docChanged ||
      transaction.selection;

    return changed ? redrawn({ focused }, transaction.state) : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/** A paragraph's wrapping line breaks drawn as spaces, except in the paragraph being edited. */
export const softBreakPreview: Extension = [
  softBreakField,
  EditorView.focusChangeEffect.of((_state, focusing) =>
    focusChanged.of(focusing),
  ),
];
