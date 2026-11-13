"use client";

import { useRef } from "react";
import { joinedParagraphs } from "./prompt-marks";
import { usePromptView } from "./prompt-view";
import styles from "./PromptEditor.module.css";

interface PromptEditorProps {
  name: string;
  defaultValue: string | undefined;
  /** What an empty editor shows: the prompt it inherits when left blank. */
  placeholder?: string;
  /** Keeps every line break as saved, for markdown whose lines are structure and not wrapped prose. */
  verbatim?: boolean;
}

/** A prompt edited in place; the hidden input carries the document as it stands, so the form submits exactly the text shown. */
export default function PromptEditor(props: PromptEditorProps) {
  const { name, defaultValue, placeholder, verbatim } = props;
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const saved = defaultValue ?? "";
  const doc = verbatim ? saved : joinedParagraphs(saved);

  usePromptView(host, field, { doc, placeholder });

  return (
    <>
      <div ref={host} className={styles.editor} />
      <input ref={field} type="hidden" name={name} defaultValue={doc} />
    </>
  );
}
