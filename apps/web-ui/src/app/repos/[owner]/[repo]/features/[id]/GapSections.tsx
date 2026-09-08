"use client";

import { Alert } from "@/components/Alert";
import MockupSection from "./MockupSection";
import styles from "./GapSections.module.scss";
import Markdown from "@/components/Markdown";
import { sectionsOf } from "@/lib/gap-sections";
import {
  SectionFeedback,
  QuestionInput,
  type FeedbackState,
} from "./GapFeedbackInputs";

const FREE_FORM_MAX = 5000;

import type {
  GapResult,
  GapSection,
  SectionAnswers,
} from "@/lib/feature-types";

export type { FeedbackState };

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

/** The section'"'"'s mockups, when the round produced any. */
function SectionMockups({
  section,
  stylesheet,
}: {
  section: GapSection;
  stylesheet: GapResult["mockup_stylesheet"];
}) {
  if (!section.mockups || section.mockups.length === 0) {
    return null;
  }

  return <MockupSection mockups={section.mockups} stylesheet={stylesheet} />;
}

interface SectionBodyProps {
  section: GapSection;
  index: number;
  gap: GapResult;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}

function SectionBody({
  section,
  index,
  gap,
  feedback,
  onChange,
}: SectionBodyProps) {
  return (
    <SectionCard title={section.title} highlight={index === 0}>
      {section.content && <Markdown markdown={section.content} />}
      <SectionMockups section={section} stylesheet={gap.mockup_stylesheet} />
      {(section.questions ?? []).map((q) => (
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

/** The round's suggestion to split this feature, when it made one. */
function SplitSuggestionSlot({
  split,
  onCreateDraft,
}: {
  split: GapResult["split_suggestion"];
  onCreateDraft: (title: string, prompt: string) => void;
}) {
  if (!split) {
    return null;
  }

  return (
    <SplitSuggestion
      rationale={split.rationale}
      // openapi marks proposed_features required, but it is an LLM-authored payload that can omit the array.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      proposedFeatures={split.proposed_features ?? []}
      onCreateDraft={onCreateDraft}
    />
  );
}

/** Direction that belongs to no section. Capped and counted because it rides into the next round's prompt: an unbounded field here is an unbounded prompt there. */
function FreeFormCard({
  feedback,
  onChange,
}: {
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}) {
  return (
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
  );
}

interface GapSectionsProps {
  gap: GapResult;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
  onCreateDraft: (title: string, prompt: string) => void;
}

/** Every section the round produced. Keyed on title AND index because two sections can legitimately share a heading, and a duplicate key would let React reuse one section's inputs for the other. */
function SectionList({
  sections,
  gap,
  feedback,
  onChange,
}: {
  sections: GapSection[];
  gap: GapResult;
  feedback: FeedbackState;
  onChange: (next: FeedbackState) => void;
}) {
  return sections.map((section, index) => (
    <SectionBody
      key={`${section.title}-${index}`}
      section={section}
      index={index}
      gap={gap}
      feedback={feedback}
      onChange={onChange}
    />
  ));
}

export default function GapSections({
  gap,
  feedback,
  onChange,
  onCreateDraft,
}: GapSectionsProps) {
  const sections = sectionsOf(gap);

  return (
    <div>
      {sections.length === 0 && (
        <NoSectionsFallback draft={gap.draft_spec_markdown?.trim() ?? ""} />
      )}
      <SectionList
        sections={sections}
        gap={gap}
        feedback={feedback}
        onChange={onChange}
      />

      <SplitSuggestionSlot
        split={gap.split_suggestion}
        onCreateDraft={onCreateDraft}
      />

      <FreeFormCard feedback={feedback} onChange={onChange} />
    </div>
  );
}
