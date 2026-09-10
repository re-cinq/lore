// The controls an author fills in on a gap section: what to do with the section, and answers to its questions.

import type { SectionDirection, GapQuestion } from "@/lib/feature-types";

/** What the author has said about a round so far: per-section direction and comment, answers to its questions, and anything that belongs to no section. */
export interface FeedbackState {
  sections: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions: Record<string, string>;
  free_form: string;
}
import styles from "./GapSections.module.scss";

interface SectionFeedbackProps {
  sectionKey: string;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}

type SectionEntry = { comment?: string; direction?: SectionDirection };

export function SectionFeedback(props: SectionFeedbackProps) {
  const { sectionKey, feedback } = props;
  const current = feedback.sections[sectionKey] ?? {};
  const set = sectionSetter(props, current);

  return (
    <div className={styles.feedback}>
      <DirectionPicker
        sectionKey={sectionKey}
        direction={current.direction}
        onSelect={(direction) => set({ direction })}
      />
      <SectionComment
        value={current.comment ?? ""}
        onSet={(comment) => set({ comment })}
      />
    </div>
  );
}

interface DirectionPickerProps {
  sectionKey: string;
  direction: SectionDirection | undefined;
  onSelect: (direction: SectionDirection) => void;
}

/** What the next round should do with this section. Defaults to "keep" so a section the author says nothing about is left alone rather than reworked. */
function DirectionPicker(props: DirectionPickerProps) {
  const { sectionKey, direction, onSelect } = props;

  return (
    <div className={styles.directionRow}>
      <select
        value={direction ?? "keep"}
        onChange={(e) => onSelect(e.target.value as SectionDirection)}
        aria-label={`${sectionKey} direction`}
      >
        <option value="keep">Keep</option>
        <option value="refine">Refine</option>
        <option value="redirect">Redirect</option>
      </select>
    </div>
  );
}

/** Merges one patch into this section's entry, leaving every other section as the author left it. */
function sectionSetter(props: SectionFeedbackProps, current: SectionEntry) {
  const { sectionKey, feedback, onChange } = props;

  return (patch: SectionEntry) =>
    onChange({
      ...feedback,
      sections: {
        ...feedback.sections,
        [sectionKey]: { ...current, ...patch },
      },
    });
}

/** The author's free-text note on a section, alongside the direction they picked for it. */
function SectionComment({
  value,
  onSet,
}: {
  value: string;
  onSet: (comment: string) => void;
}) {
  return (
    <textarea
      className={styles.commentInput}
      placeholder="Comment / direction for this section"
      value={value}
      onChange={(e) => onSet(e.target.value)}
    />
  );
}

interface QuestionInputProps {
  q: GapQuestion;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}

/** One follow-up question for a section — short label, detail in `why`, answer input. */
export function QuestionInput(props: QuestionInputProps) {
  const { q, feedback } = props;

  return (
    <div className={styles.question}>
      <label htmlFor={q.id} className={styles.questionLabel}>
        {q.question}
      </label>
      {q.why && <p className={`meta ${styles.questionWhy}`}>{q.why}</p>}
      <AnswerControl
        q={q}
        value={feedback.questions[q.id] ?? ""}
        onSet={answerSetter(props)}
      />
    </div>
  );
}

/** Records one answer, leaving every other answer the author gave untouched. */
function answerSetter(props: QuestionInputProps) {
  const { q, feedback, onChange } = props;

  return (value: string) =>
    onChange({
      ...feedback,
      questions: { ...feedback.questions, [q.id]: value },
    });
}

interface AnswerControlProps {
  q: GapQuestion;
  value: string;
  onSet: (value: string) => void;
}

/** A select when the round offered options, a free-text box otherwise. The empty option is kept so an answered question can be un-answered — a choice the author regrets should not be stuck. */
function AnswerControl(props: AnswerControlProps) {
  const { q, value, onSet } = props;

  if (q.kind !== "choice" || !q.options) {
    return (
      <input id={q.id} value={value} onChange={(e) => onSet(e.target.value)} />
    );
  }

  return (
    <select id={q.id} value={value} onChange={(e) => onSet(e.target.value)}>
      <option value="">—</option>
      {q.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
