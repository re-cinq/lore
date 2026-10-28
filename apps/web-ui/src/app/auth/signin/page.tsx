import BrandLockup from "@/components/BrandLockup";
import styles from "./page.module.css";

export default function SignIn() {
  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <h1 className={styles.title} aria-label="Lore">
          <BrandLockup />
        </h1>
        <p className={styles.subtitle}>Sign in to access the platform</p>
        <a href="/auth/start" className={styles.button}>
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}
