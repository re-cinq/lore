'use client';

import { useSession, signOut } from 'next-auth/react';

export default function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  return (
    <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        {session.user.image && (
          <img
            src={session.user.image}
            alt="avatar"
            style={{ width: 32, height: 32, borderRadius: 'var(--radius-pill)' }}
          />
        )}
        <span style={{ color: 'var(--text)', fontSize: 'var(--fs-base)' }}>
          {session.user.name || session.user.email}
        </span>
      </div>
      <button
        onClick={() => signOut()}
        className="btn-secondary"
        style={{ width: '100%', padding: '6px 12px', fontSize: 'var(--fs-sm)' }}
      >
        Sign out
      </button>
    </div>
  );
}
