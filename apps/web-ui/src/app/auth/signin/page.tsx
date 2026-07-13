"use client";
import { signIn } from "next-auth/react";
import styles from "./page.module.css";

export default function SignIn() {
  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Lore</h1>
        <p className={styles.subtitle}>Sign in to access the platform</p>
        <button
          onClick={() => signIn("github", { callbackUrl: "/" })}
          className={styles.button}
        >
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}
