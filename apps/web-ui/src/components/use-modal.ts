import { useEffect, useRef } from "react";

/** A `<dialog>` opened as a modal when it mounts, so its owner decides whether it is open by mounting it. */
export function useModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return dialogRef;
}
