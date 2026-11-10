import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { marksField } from "./marks-field";
import { collapsedMarkup } from "./prompt-marks";
import type { Range } from "./ranges";
import { TableWidget } from "./table-widget";

const focusChanged = StateEffect.define<boolean>();

interface TablePreview {
  focused: boolean;
  decorations: DecorationSet;
}

/** Draws each table the selection does not touch as a rendered table. Replacing whole lines with a block widget is a decoration only a state field may provide. Unfocused, nothing is being edited, so every table is drawn. */
export const tablePreview = [
  StateField.define<TablePreview>({
    create: (state) => ({
      focused: false,
      decorations: drawnTables(state, null),
    }),
    update(preview, transaction) {
      const focused = transaction.effects.reduce(
        (current, effect) => (effect.is(focusChanged) ? effect.value : current),
        preview.focused,
      );
      const changed =
        transaction.docChanged ||
        transaction.selection !== undefined ||
        focused !== preview.focused;
      const { state } = transaction;
      const edited = focused ? state.selection.main : null;

      return changed
        ? { focused, decorations: drawnTables(state, edited) }
        : preview;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (preview) => preview.decorations),
  }),
  EditorView.focusChangeEffect.of((_state, focusing) =>
    focusChanged.of(focusing),
  ),
];

function drawnTables(state: EditorState, edited: Range | null): DecorationSet {
  const tables = state
    .field(marksField)
    .flatMap((mark) => (mark.kind === "table" ? [mark] : []));
  const collapsed = collapsedMarkup(state.sliceDoc(), tables, edited);

  return Decoration.set(
    tables
      .filter((table) => collapsed.some((range) => range.from === table.from))
      .map((table) =>
        Decoration.replace({
          widget: new TableWidget(table.table, table.from),
          block: true,
        }).range(table.from, table.to),
      ),
  );
}
