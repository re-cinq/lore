// The one way a form reports that a submit failed.
//
// Five call sites had rolled their own, none identical and only one announcing
// itself — a failed submit was otherwise silent to a screen reader. `role="alert"`
// is the whole point of sharing it; the colour is incidental.
//
// Deliberately NOT adopted everywhere: FailureBlock's card is already an alert
// region (nesting a second one is an a11y regression), AgentForm needs inline
// spans in a flex row, and SaveResultBanner is a five-branch status banner over a
// different union. Three of those five sites are different knowledge.
export function FormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) {
    return null;
  }

  return (
    <p
      role="alert"
      className={className}
      style={{ color: "var(--danger)", margin: "4px 0 0" }}
    >
      {message}
    </p>
  );
}
