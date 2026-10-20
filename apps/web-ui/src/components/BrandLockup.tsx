/** The Lore mark (the braced ore cart, Lore Logo 4b) beside the "lore / by re:cinq" wordmark. Both scheme variants are rendered and CSS shows the one matching `data-color-scheme`, so the server-rendered page never flashes the wrong cart before the theme script runs. */
export default function BrandLockup() {
  return (
    <span className="brand-lockup">
      <BrandMarks />
      <span className="brand-words rail-hidden">
        <span className="brand-name">lore</span>
        <span className="brand-by">by re:cinq</span>
      </span>
    </span>
  );
}

/** The cart alone, in both scheme variants: the lockup's mark, and the mobile header's. */
export function BrandMarks() {
  return (
    <>
      <BrandMark scheme="light" />
      <BrandMark scheme="dark" />
    </>
  );
}

function BrandMark({ scheme }: { scheme: "light" | "dark" }) {
  const src = scheme === "light" ? "/lore-logo.svg" : "/lore-logo-dark.svg";

  return (
    <img
      src={src}
      alt=""
      width={58}
      height={44}
      className={`brand-mark brand-mark-${scheme}`}
    />
  );
}
