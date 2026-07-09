// This app depends on react-dom (19) but not @types/react-dom, so the
// form hooks it exposes are untyped. Declare the one we use rather than
// pulling in the full type package.
declare module 'react-dom' {
  export function useFormStatus(): {
    pending: boolean;
    data: FormData | null;
    method: string | null;
    action: string | ((formData: FormData) => void | Promise<void>) | null;
  };
}
