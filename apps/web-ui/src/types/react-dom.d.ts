// Declare useFormStatus (react-dom 19) to avoid @types/react-dom.
declare module "react-dom" {
  export function useFormStatus(): {
    pending: boolean;
    data: FormData | null;
    method: string | null;
    action: string | ((formData: FormData) => void | Promise<void>) | null;
  };
}
