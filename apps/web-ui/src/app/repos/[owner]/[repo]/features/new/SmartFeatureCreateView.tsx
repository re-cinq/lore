'use client';

import { useActionState } from 'react';

type CreateAction = (
  prev: { error?: string } | null,
  formData: FormData,
) => Promise<{ error?: string }>;

export default function SmartFeatureCreateView({ action }: { action: CreateAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="task-form" style={{ maxWidth: 720 }}>
      <h2>Plan a new feature</h2>
      <p className="meta">
        Describe what you want. A planning Station analyzes it against this project and returns a
        gap-closing analysis you can refine before a spec PR is opened.
      </p>
      <label>
        Title
        <input name="title" required placeholder="Short feature name" />
      </label>
      <label>
        Describe the feature
        <textarea name="prompt" rows={6} required placeholder="What should it do, for whom, and why?" />
      </label>
      {state?.error && <p style={{ color: '#dc2626' }}>{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? 'Starting planning…' : 'Start planning'}
      </button>
    </form>
  );
}
