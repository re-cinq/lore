"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/FormError";

type DraftAgain = () => Promise<{ error?: string }>;

/** Starts a fresh planning run for the plan and reloads the page onto it; `*Button.tsx` keeps this exempt from no-io-in-view. */
export default function DraftAgainButton({
  draftAgain,
}: {
  draftAgain: DraftAgain;
}) {
  const { pending, error, start } = useDraftAgain(draftAgain);

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() => void start()}
      >
        Draft again
      </button>
      <FormError message={error} />
    </>
  );
}

function useDraftAgain(draftAgain: DraftAgain) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const start = async () => {
    setPending(true);
    const started = await draftAgain();

    setPending(false);
    setError(started.error);

    if (!started.error) {
      router.refresh();
    }
  };

  return { pending, error, start };
}
