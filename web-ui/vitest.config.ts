import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // IO / config glue — not unit-testable without a live DB / auth / GitHub.
        // The container/presentational split keeps render logic in *View.tsx
        // (covered) and confines IO to these files and the page.tsx containers.
        'src/lib/db.ts',
        'src/lib/trace-api.ts',
        'src/lib/auth.ts',
        'src/lib/auth-options.ts',
        'src/lib/session.ts',
        'src/lib/github.ts',
        'src/lib/api-error.ts',
        'src/lib/theme/fonts.ts',
        'src/lib/theme/theme-script.ts',
        'src/middleware.ts',
        // Next.js API route handlers (server endpoints → DB/GitHub IO).
        'src/app/api/**',
        // App Router containers (data fetching only → return <XView .../>) + layouts
        // + the next-auth session provider wrapper.
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
        'src/app/SessionWrapper.tsx',
        // Test / type-only files.
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
  },
});
