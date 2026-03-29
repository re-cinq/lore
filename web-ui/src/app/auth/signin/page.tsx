'use client';
import { signIn } from 'next-auth/react';

export default function SignIn() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: '#ededed', marginBottom: '24px' }}>Lore</h1>
        <p style={{ color: '#666', marginBottom: '24px' }}>Sign in to access the platform</p>
        <button onClick={() => signIn('github', { callbackUrl: '/' })}
          style={{ padding: '12px 24px', background: '#333', color: '#ededed', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}
