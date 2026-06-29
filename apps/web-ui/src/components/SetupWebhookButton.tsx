'use client';

import { useTransition } from 'react';
import styles from './ReonboardButton.module.css';

export default function SetupWebhookButton({
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
      className={styles.button}
      style={{ cursor: pending ? 'default' : 'pointer' }}
    >
      {pending ? 'setting up…' : text}
    </button>
  );
}
