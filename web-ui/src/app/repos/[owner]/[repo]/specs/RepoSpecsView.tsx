import HelpPopover from '@/components/HelpPopover';
import SpecCard, { type SpecCardData } from './SpecCard';

export interface RepoSpecsViewProps {
  owner: string;
  repo: string;
  specs: SpecCardData[];
  /** Server action wired to the Add-Spec form ("actions up"). */
  addSpecAction: (formData: FormData) => void | Promise<void>;
}

/**
 * Presentational view for a repo's spec list. Pure render — the spec
 * view-model is resolved by the container (`page.tsx`) and passed down;
 * the only mutation (Add Spec) is handed in as `addSpecAction` and fired
 * back up via the form, keeping this component free of data access.
 */
export default function RepoSpecsView({ owner, repo, specs, addSpecAction }: RepoSpecsViewProps) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ margin: 0 }}>Specifications</h2>
        <HelpPopover label="How specs are used">
          <p>Specs are stored as context chunks for this repo and become part of the context Lore assembles for agents:</p>
          <ul>
            <li><strong>feature-request</strong> tasks turn a plain-language intent into a spec.</li>
            <li><strong>implementation</strong> and <strong>review</strong> tasks read the spec to build and check against the intended contract.</li>
            <li>They surface in <code>assemble_context</code> and <code>search_context</code> alongside ADRs and conventions.</li>
          </ul>
          <p>Test coverage on each card is derived from inline test links in the spec.md (<code>([validated by ...](path/to/test.ts#L42))</code> at end of statement).</p>
          <p className="meta">Note: a spec added here is saved and listed below immediately, but is only picked up by semantic search after the next ingestion generates its embeddings.</p>
        </HelpPopover>
      </div>
      <p className="meta" style={{ marginTop: '6px', marginBottom: '16px' }}>
        Specifications and design docs for this repo. Add your own or browse what&apos;s been ingested.
      </p>

      <form action={addSpecAction} className="task-form" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={repo} />

        <label htmlFor="spec-path">Spec path</label>
        <input
          id="spec-path"
          name="file_path"
          required
          placeholder="specs/my-feature/spec.md"
          pattern="([\w.-]+/)*[\w.-]+\.md"
          title="Relative path ending in .md, e.g. specs/my-feature/spec.md (no leading slash)"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)' }}
        />
        <span className="meta" style={{ fontSize: 'var(--fs-xs)' }}>
          Relative path within the repo, ending in <code>.md</code> — e.g. <code>specs/my-feature/spec.md</code>. No leading slash.
        </span>

        <label>Content</label>
        <textarea name="content" required rows={8} placeholder="Describe the specification..." style={{ width: '100%', fontFamily: 'var(--font-mono)', resize: 'vertical' }} />

        <button type="submit">Add Spec</button>
      </form>

      {specs.map((spec) => (
        <SpecCard key={spec.spec_path} owner={owner} repo={repo} spec={spec} />
      ))}
      {specs.length === 0 && <p className="meta">No specs found for this repo.</p>}
    </div>
  );
}
