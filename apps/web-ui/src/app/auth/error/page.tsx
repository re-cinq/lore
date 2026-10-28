import BrandLockup from "@/components/BrandLockup";
import { failureOf, signInFailureMessage } from "@/lib/sign-in-callback";
import styles from "../signin/page.module.css";

interface ErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function SignInError({ searchParams }: ErrorPageProps) {
  const { reason } = await searchParams;

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <h1 className={styles.title} aria-label="Lore">
          <BrandLockup />
        </h1>
        <p className={styles.subtitle}>
          {signInFailureMessage(failureOf(reason ?? ""))}
        </p>
        <a href="/auth/start" className={styles.button}>
          Try again
        </a>
      </div>
    </div>
  );
}
