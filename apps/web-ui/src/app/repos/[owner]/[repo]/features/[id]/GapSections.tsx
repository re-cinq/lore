"use client";

import { Alert } from "@/components/Alert";
import MockupSection from "./MockupSection";
import styles from "./GapSections.module.scss";
import Markdown from "@/components/Markdown";
import { sectionsOf } from "@/lib/gap-sections";
import type {
  GapResult,
  GapQuestion,
  GapSection,
  SectionAnswers,
  SectionDirection,
} from "@/lib/feature-types";

const FREE_FORM_MAX = 5000;

export interface FeedbackState {
  sections: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions: Record<string, string>;
  free_form: string;
}

export function emptyFeedback(): FeedbackState {
  return { sections: {}, questions: {}, free_form: "" };
}

export function toUserAnswers(f: FeedbackState): SectionAnswers {
  return {
    sections: f.sections,
    questions: f.questions,
    free_form: f.free_form,
  };
}

function SectionFeedback({
  sectionKey,
  feedback,
  onChange,
}: {
  sectionKey: string;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}) {
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
      <div className={styles.directionRow}>
        <select
          value={current.direction ?? "keep"}
          onChange={(e) =>
            set({ direction: e.target.value as SectionDirection })
          }
          aria-label={`${sectionKey} direction`}
        >
          <option value="keep">Keep</option>
          <option value="refine">Refine</option>
          <option value="redirect">Redirect</option>
        </select>
      </div>
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
function QuestionInput({
  q,
  feedback,
  onChange,
}: {
  q: GapQuestion;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}) {
  const set = (value: string) =>
    onChange({
      ...feedback,
      questions: { ...feedback.questions, [q.id]: value },
    });

  return (
    <div className={styles.question}>
      <label htmlFor={q.id} className={styles.questionLabel}>
        {q.question}
      </label>
      {q.why && <p className={`meta ${styles.questionWhy}`}>{q.why}</p>}
      {q.kind === "choice" && q.options ? (
        <select
          id={q.id}
          value={feedback.questions[q.id] ?? ""}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">—</option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={q.id}
          value={feedback.questions[q.id] ?? ""}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </div>
  );
}

function SectionCard({
  title,
  highlight,
  children,
}: {
  title: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={highlight ? "spec-card overview" : "spec-card"}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function NoSectionsFallback({ draft }: { draft: string }) {
  if (draft) {
    return (
      <SectionCard title="Draft specification" highlight>
        <Alert>
          This round returned a single draft rather than reviewable sections.
        </Alert>
        <Markdown markdown={draft} />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="No analysis to review">
      <Alert>
        This round produced no reviewable analysis. Add direction below and
        refine again.
      </Alert>
    </SectionCard>
  );
}

function SectionBody({
  section,
  index,
  gap,
  feedback,
  onChange,
}: {
  section: GapSection;
  index: number;
  gap: GapResult;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}) {
  return (
    <SectionCard title={section.title} highlight={index === 0}>
      {section.content && <Markdown markdown={section.content} />}
      {section.mockups && section.mockups.length > 0 && (
        <MockupSection
          mockups={section.mockups}
          stylesheet={gap.mockup_stylesheet}
        />
      )}
      {section.questions?.map((q) => (
        <QuestionInput
          key={q.id}
          q={q}
          feedback={feedback}
          onChange={onChange}
        />
      ))}
      <SectionFeedback
        sectionKey={section.title}
        feedback={feedback}
        onChange={onChange}
      />
    </SectionCard>
  );
}

function SplitSuggestion({
  rationale,
  proposedFeatures,
  onCreateDraft,
}: {
  rationale: string;
  proposedFeatures: { title: string; scope: string }[];
  onCreateDraft: (title: string, prompt: string) => void;
}) {
  return (
    <SectionCard title="This feature looks large — consider splitting">
      <p>{rationale}</p>
      {proposedFeatures.map((p, i) => (
        <div key={i} className={styles.splitRow}>
          <span>
            <strong>{p.title}</strong> — <span className="meta">{p.scope}</span>
          </span>
          <button type="button" onClick={() => onCreateDraft(p.title, p.scope)}>
            Create draft
          </button>
        </div>
      ))}
    </SectionCard>
  );
}

export default function GapSections({
  gap,
  feedback,
  onChange,
  onCreateDraft,
}: {
  gap: GapResult;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
  onCreateDraft: (title: string, prompt: string) => void;
}) {
  const sections = sectionsOf(gap);
  // Fall back to draft when round produced no sections; say so plainly when there is neither.
  const draft = gap.draft_spec_markdown?.trim() ?? "";

  return (
    <div>
      {sections.length === 0 && <NoSectionsFallback draft={draft} />}
      {sections.map((section, i) => (
        <SectionBody
          key={`${section.title}-${i}`}
          section={section}
          index={i}
          gap={gap}
          feedback={feedback}
          onChange={onChange}
        />
      ))}

      {gap.split_suggestion && (
        <SplitSuggestion
          rationale={gap.split_suggestion.rationale}
          // openapi marks proposed_features required, but it's an LLM-authored payload that can omit the array.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          proposedFeatures={gap.split_suggestion.proposed_features ?? []}
          onCreateDraft={onCreateDraft}
        />
      )}

      <SectionCard title="Anything else?">
        <textarea
          rows={3}
          maxLength={FREE_FORM_MAX}
          placeholder="Free-form direction for the next round"
          value={feedback.free_form}
          onChange={(e) => onChange({ ...feedback, free_form: e.target.value })}
        />
        <p className={`meta ${styles.freeFormCount}`}>
          {feedback.free_form.length}/{FREE_FORM_MAX}
        </p>
      </SectionCard>
    </div>
  );
}
