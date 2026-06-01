'use client';

import { useTransition } from 'react';

export default function ReonboardButton({
  action,
  text,
}: {
  action: () => Promise<void>;
  text: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => action())}
      style={{
        fontSize: 'var(--fs-xs)',
        background: 'none',
        border: 'none',
        padding: 0,
        color: 'var(--accent)',
        cursor: pending ? 'default' : 'pointer',
        textDecoration: 'underline',
      }}
    >
      {pending ? 'opening PR…' : text}
    </button>
  );
}
