'use client';

import RouteError from '@/components/RouteError';

export default function AssemblyLinesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
