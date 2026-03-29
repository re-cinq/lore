'use client';

import { useSession, signOut } from 'next-auth/react';

export default function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  return (
    <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid #222' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        {session.user.image && (
          <img
            src={session.user.image}
            alt="avatar"
            style={{ width: 32, height: 32, borderRadius: '50%' }}
          />
        )}
        <span style={{ color: '#ededed', fontSize: '14px' }}>
          {session.user.name || session.user.email}
        </span>
      </div>
      <button
        onClick={() => signOut()}
        style={{
          width: '100%',
          padding: '6px 12px',
          background: '#222',
          color: '#999',
          border: '1px solid #333',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
