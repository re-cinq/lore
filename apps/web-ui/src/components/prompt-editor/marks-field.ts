import { StateField } from "@codemirror/state";
import { promptMarks, type PromptMark } from "./prompt-marks";

/** The marks of the document, found once per edit for every part of the preview that draws them. */
export const marksField = StateField.define<PromptMark[]>({
  create: (state) => promptMarks(state.sliceDoc()),
  update: (marks, transaction) =>
    transaction.docChanged ? promptMarks(transaction.state.sliceDoc()) : marks,
});
