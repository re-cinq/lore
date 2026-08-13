"use client";

import MockupSection from "./MockupSection";
import Markdown from "@/components/Markdown";
import { sectionsOf } from "@/lib/gap-sections";
import type {
  GapResult,
  GapQuestion,
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
    <div style={{ marginTop: 10 }}>
      <div style={{ marginBottom: 6 }}>
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
        style={{ minHeight: 250 }}
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
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={q.id} style={{ display: "block", fontWeight: 600 }}>
        {q.question}
      </label>
      {q.why && (
        <p className="meta" style={{ margin: "2px 0" }}>
          {q.why}
        </p>
      )}
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
          style={{ width: "100%" }}
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
    <div
      className={highlight ? "spec-card overview" : "spec-card"}
      style={{ marginBottom: 12 }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
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
  // A round can return a valid GapResult with no sections at all (sanitizeGapResult
  // accepts it) — one produced exactly that beside an 8KB draft. Rendering the
  // section list alone would show a blank page over a result that exists, so fall
  // back to the draft, and say so plainly when there is neither.
  const draft = gap.draft_spec_markdown?.trim() ?? "";

  return (
    <div>
      {sections.length === 0 && draft && (
        <SectionCard title="Draft specification" highlight>
          <p className="meta">
            This round returned a single draft rather than reviewable sections.
          </p>
          <Markdown markdown={draft} />
        </SectionCard>
      )}
      {sections.length === 0 && !draft && (
        <SectionCard title="No analysis to review">
          <p className="meta">
            This round produced no reviewable analysis. Add direction below and
            refine again.
          </p>
        </SectionCard>
      )}
      {sections.map((section, i) => (
        <SectionCard
          key={`${section.title}-${i}`}
          title={section.title}
          highlight={i === 0}
        >
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
      ))}

      {gap.split_suggestion && (
        <SectionCard title="This feature looks large — consider splitting">
          <p>{gap.split_suggestion.rationale}</p>
          {(gap.split_suggestion.proposed_features ?? []).map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span>
                <strong>{p.title}</strong> —{" "}
                <span className="meta">{p.scope}</span>
              </span>
              <button
                type="button"
                onClick={() => onCreateDraft(p.title, p.scope)}
              >
                Create draft
              </button>
            </div>
          ))}
        </SectionCard>
      )}

      <SectionCard title="Anything else?">
        <textarea
          style={{ width: "100%" }}
          rows={3}
          maxLength={FREE_FORM_MAX}
          placeholder="Free-form direction for the next round"
          value={feedback.free_form}
          onChange={(e) => onChange({ ...feedback, free_form: e.target.value })}
        />
        <p className="meta" style={{ margin: "2px 0 0", textAlign: "right" }}>
          {feedback.free_form.length}/{FREE_FORM_MAX}
        </p>
      </SectionCard>
    </div>
  );
}
