import BrandLockup from "@/components/BrandLockup";
import styles from "./signin/page.module.css";

interface SignInPanelProps {
  message: string;
  action: string;
  /** Where the link leads: the start of the sign-in, carrying the page to come back to. */
  href: string;
}

/** The centred card of the sign-in pages: the brand, a line of text, and the link that starts the sign-in. */
export default function SignInPanel({
  message,
  action,
  href,
}: SignInPanelProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <h1 className={styles.title} aria-label="Lore">
          <BrandLockup />
        </h1>
        <p className={styles.subtitle}>{message}</p>
        <a href={href} className={styles.button}>
          {action}
        </a>
      </div>
    </div>
  );
}
