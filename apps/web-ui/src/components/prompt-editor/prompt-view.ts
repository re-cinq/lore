import { useEffect, type RefObject } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as emptyText } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { livePreview } from "./live-preview";

export interface PromptViewOptions {
  doc: string;
  /** What an empty editor shows: the prompt it inherits when left blank. */
  placeholder: string | undefined;
  onChange(text: string): void;
}

/** Mounts a prompt editor in `host` for as long as the component lives, writing each edit into `field`. */
export function usePromptView(
  host: RefObject<HTMLElement | null>,
  field: RefObject<HTMLInputElement | null>,
  { doc, placeholder }: Omit<PromptViewOptions, "onChange">,
): void {
  useEffect(() => {
    const view = promptView(host.current, {
      doc,
      placeholder,
      onChange: (text) => {
        if (field.current) {
          field.current.value = text;
        }
      },
    });

    return () => view.destroy();
  }, [host, field, doc, placeholder]);
}

function promptView(
  parent: HTMLElement | null,
  options: PromptViewOptions,
): EditorView {
  return new EditorView({
    parent: parent ?? undefined,
    state: EditorState.create({
      doc: options.doc,
      extensions: promptExtensions(options),
    }),
  });
}

function promptExtensions({
  placeholder,
  onChange,
}: PromptViewOptions): Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    livePreview,
    EditorView.lineWrapping,
    emptyText(placeholder ?? ""),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.sliceDoc());
      }
    }),
  ];
}
