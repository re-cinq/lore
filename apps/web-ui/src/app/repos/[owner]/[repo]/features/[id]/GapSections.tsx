'use client';

import MockupSection from './MockupSection';
import type { GapResult, SectionAnswers, SectionDirection } from '@/lib/feature-types';

export interface FeedbackState {
  sections: Record<string, { comment?: string; direction?: SectionDirection }>;
  questions: Record<string, string>;
  free_form: string;
}

export function emptyFeedback(): FeedbackState {
  return { sections: {}, questions: {}, free_form: '' };
}

export function toUserAnswers(f: FeedbackState): SectionAnswers {
  return { sections: f.sections, questions: f.questions, free_form: f.free_form };
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
      sections: { ...feedback.sections, [sectionKey]: { ...current, ...patch } },
    });
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ marginBottom: 6 }}>
        <select
          value={current.direction ?? 'keep'}
          onChange={(e) => set({ direction: e.target.value as SectionDirection })}
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
        value={current.comment ?? ''}
        onChange={(e) => set({ comment: e.target.value })}
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="spec-card" style={{ marginBottom: 12 }}>
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
  return (
    <div>
      {gap.architecture && (
        <SectionCard title="Architecture">
          <p>{gap.architecture.summary}</p>
          <ul>
            {gap.architecture.components.map((c, i) => (
              <li key={i}>
                <strong>{c.name}</strong> — {c.responsibility}
                {c.touchpoints?.length > 0 && (
                  <span className="meta"> ({c.touchpoints.join(', ')})</span>
                )}
              </li>
            ))}
          </ul>
          <SectionFeedback sectionKey="architecture" feedback={feedback} onChange={onChange} />
        </SectionCard>
      )}

      {gap.user_flows && gap.user_flows.length > 0 && (
        <SectionCard title="User flows">
          {gap.user_flows.map((flow, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <strong>{flow.name}</strong>
              <ol>
                {flow.steps.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
          <SectionFeedback sectionKey="user_flows" feedback={feedback} onChange={onChange} />
        </SectionCard>
      )}

      {gap.mockups && gap.mockups.length > 0 && (
        <SectionCard title="Mockups">
          <MockupSection mockups={gap.mockups} />
          <SectionFeedback sectionKey="mockups" feedback={feedback} onChange={onChange} />
        </SectionCard>
      )}

      {gap.questions && gap.questions.length > 0 && (
        <SectionCard title="Questions">
          {gap.questions.map((q) => (
            <div key={q.id} style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontWeight: 600 }}>{q.question}</label>
              {q.why && <p className="meta" style={{ margin: '2px 0' }}>{q.why}</p>}
              {q.kind === 'choice' && q.options ? (
                <select
                  value={feedback.questions[q.id] ?? ''}
                  onChange={(e) => onChange({ ...feedback, questions: { ...feedback.questions, [q.id]: e.target.value } })}
                >
                  <option value="">—</option>
                  {q.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  style={{ width: '100%' }}
                  value={feedback.questions[q.id] ?? ''}
                  onChange={(e) => onChange({ ...feedback, questions: { ...feedback.questions, [q.id]: e.target.value } })}
                />
              )}
            </div>
          ))}
        </SectionCard>
      )}

      {gap.split_suggestion && (
        <SectionCard title="This feature looks large — consider splitting">
          <p>{gap.split_suggestion.rationale}</p>
          {gap.split_suggestion.proposed_features.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span><strong>{p.title}</strong> — <span className="meta">{p.scope}</span></span>
              <button type="button" onClick={() => onCreateDraft(p.title, p.scope)}>
                Create draft
              </button>
            </div>
          ))}
        </SectionCard>
      )}

      <SectionCard title="Anything else?">
        <textarea
          style={{ width: '100%' }}
          rows={3}
          placeholder="Free-form direction for the next round"
          value={feedback.free_form}
          onChange={(e) => onChange({ ...feedback, free_form: e.target.value })}
        />
      </SectionCard>
    </div>
  );
}
