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

/** What the next round should do with this section. Defaults to "keep" so a section the author says nothing about is left alone rather than reworked. */
function DirectionPicker({
  sectionKey,
  direction,
  onSelect,
}: {
  sectionKey: string;
  direction: SectionDirection | undefined;
  onSelect: (direction: SectionDirection) => void;
}) {
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

export function SectionFeedback({
  sectionKey,
  feedback,
  onChange,
}: SectionFeedbackProps) {
  const current = feedback.sections[sectionKey] ?? {};
  const set = (patch: { comment?: string; direction?: SectionDirection }) =>
    onChange({
      ...feedback,
      sections: {
        ...feedback.sections,
        [sectionKey]: { ...current, ...patch },
      },
    });

  return (
    <div className={styles.feedback}>
      <DirectionPicker
        sectionKey={sectionKey}
        direction={current.direction}
        onSelect={(direction) => set({ direction })}
      />
      <textarea
        className={styles.commentInput}
        placeholder="Comment / direction for this section"
        value={current.comment ?? ""}
        onChange={(e) => set({ comment: e.target.value })}
      />
    </div>
  );
}

/** One follow-up question for a section — short label, detail in `why`, answer input. */
export function QuestionInput({
  q,
  feedback,
  onChange,
}: {
  q: GapQuestion;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}) {
  return (
    <div className={styles.question}>
      <label htmlFor={q.id} className={styles.questionLabel}>
        {q.question}
      </label>
      {q.why && <p className={`meta ${styles.questionWhy}`}>{q.why}</p>}
      <AnswerControl
        q={q}
        value={feedback.questions[q.id] ?? ""}
        onSet={(value) =>
          onChange({
            ...feedback,
            questions: { ...feedback.questions, [q.id]: value },
          })
        }
      />
    </div>
  );
}

/** A select when the round offered options, a free-text box otherwise. The empty option is kept so an answered question can be un-answered — a choice the author regrets should not be stuck. */
function AnswerControl({
  q,
  value,
  onSet,
}: {
  q: GapQuestion;
  value: string;
  onSet: (value: string) => void;
}) {
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
