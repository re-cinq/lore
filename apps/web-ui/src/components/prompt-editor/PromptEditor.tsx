"use client";

import { useRef } from "react";
import { usePromptView } from "./prompt-view";
import styles from "./PromptEditor.module.css";

interface PromptEditorProps {
  name: string;
  defaultValue: string | undefined;
  /** What an empty editor shows: the prompt it inherits when left blank. */
  placeholder?: string;
}

/** A prompt edited in place; the hidden input carries the document as it stands, so the form submits exactly the text shown. */
export default function PromptEditor(props: PromptEditorProps) {
  const { name, defaultValue, placeholder } = props;
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  usePromptView(host, field, { doc: defaultValue ?? "", placeholder });

  return (
    <>
      <div ref={host} className={styles.editor} />
      <input
        ref={field}
        type="hidden"
        name={name}
        defaultValue={defaultValue}
      />
    </>
  );
}
