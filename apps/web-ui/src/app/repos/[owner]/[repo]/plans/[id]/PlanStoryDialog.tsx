"use client";

import { useEffect, useId, useRef, useState } from "react";
import confirmStyles from "@/components/ConfirmDialog.module.scss";
import { FormError } from "@/components/FormError";
import PendingActionButton from "@/components/PendingActionButton";
import {
  useRefreshingAction,
  type ServerAction,
} from "@/components/useRefreshingAction";
import type { PlanStory } from "@/lib/api/plans";
import { storyField } from "@/lib/plan-input";
import styles from "./PlanStoryDialog.module.scss";

interface PlanStoryDialogProps {
  repo: string;
  story: PlanStory | null;
  save: (text: string) => ReturnType<ServerAction>;
  remove: ServerAction;
  onClose: () => void;
}

/** A modal to link the plan to a user story, change the link or remove it. Mounted only while open, so the caller owns whether it is; Escape closes it. */
export default function PlanStoryDialog(props: PlanStoryDialogProps) {
  const titleId = useId();

  return (
    <dialog
      ref={useModal()}
      className={confirmStyles.dialog}
      aria-labelledby={titleId}
      onCancel={props.onClose}
    >
      <h2 id={titleId}>User story</h2>
      <StoryForm {...props} />
    </dialog>
  );
}

function StoryForm(props: PlanStoryDialogProps) {
  const form = useStoryForm(props);

  return (
    <>
      <StoryField form={form} />
      <p className="meta">
        The planning agent reads it from the next planning run on.
      </p>
      <FormError message={form.error} />
      <div className={confirmStyles.actions}>
        <button type="button" className="btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <RemoveLink story={props.story} form={form} />
        <SaveStory form={form} />
      </div>
    </>
  );
}

type StoryFormState = ReturnType<typeof useStoryForm>;

function useStoryForm({
  repo,
  story,
  save,
  remove,
  onClose,
}: PlanStoryDialogProps) {
  const [text, setText] = useState(issueText(story));
  const saving = useClosingAction(() => save(text), onClose);
  const removing = useClosingAction(remove, onClose);

  return {
    text,
    setText,
    problem: problemOf(text, repo),
    saving,
    removing,
    busy: saving.pending || removing.pending,
    error: saving.error ?? removing.error,
  };
}

function StoryField({ form }: { form: StoryFormState }) {
  const problemId = useId();

  return (
    <div className={confirmStyles.typedName}>
      <label>
        Issue URL or number
        <StoryInput form={form} problemId={problemId} />
      </label>
      <span id={problemId} className={styles.problem}>
        {form.problem}
      </span>
    </div>
  );
}

function StoryInput({
  form,
  problemId,
}: {
  form: StoryFormState;
  problemId: string;
}) {
  return (
    <input
      type="text"
      value={form.text}
      autoComplete="off"
      placeholder="An issue URL, or its number: 123"
      aria-describedby={problemId}
      aria-invalid={form.problem !== undefined}
      onChange={(event) => form.setText(event.target.value)}
    />
  );
}

function RemoveLink({
  story,
  form,
}: {
  story: PlanStory | null;
  form: StoryFormState;
}) {
  if (issueText(story) === "") {
    return null;
  }

  return (
    <PendingActionButton
      action={form.removing.run}
      text="Remove link"
      pendingText="Remove link"
      pending={form.busy}
      className="danger"
    />
  );
}

// Blank is not wrong, only not savable; a wrong text is said under the field.
function SaveStory({ form }: { form: StoryFormState }) {
  const savable = form.text.trim() !== "" && form.problem === undefined;

  return (
    <PendingActionButton
      action={form.saving.run}
      text="Save"
      pendingText="Save"
      pending={form.busy}
      disabled={!savable}
      className=""
    />
  );
}

function issueText(story: PlanStory | null): string {
  const issue = story?.issueNumber ?? null;

  return issue === null ? "" : String(issue);
}

function problemOf(text: string, repo: string): string | undefined {
  const named = storyField(text, repo);

  return "error" in named ? named.error : undefined;
}

// The dialog stays open on a refusal, which it shows, and closes only once the change is saved.
function useClosingAction(action: ServerAction, onClose: () => void) {
  return useRefreshingAction(async () => {
    const result = await action();

    if (!result.error) {
      onClose();
    }

    return result;
  });
}

function useModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return dialogRef;
}
