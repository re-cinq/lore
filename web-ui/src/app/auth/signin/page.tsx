'use client';
import { signIn } from 'next-auth/react';

export default function SignIn() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: 'var(--text)', marginBottom: '24px' }}>Lore</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Sign in to access the platform</p>
        <button onClick={() => signIn('github', { callbackUrl: '/' })}
          style={{ padding: '12px 24px', background: 'var(--bg-surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '16px' }}>
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}
