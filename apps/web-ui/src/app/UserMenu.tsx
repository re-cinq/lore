"use client";

import { useSession, signOut } from "next-auth/react";
import styles from "./UserMenu.module.css";

export default function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  return (
    <div className={styles.menu}>
      <div className={styles.row}>
        {session.user.image && (
          <img
            src={session.user.image}
            alt="avatar"
            className={styles.avatar}
          />
        )}
        <span className={styles.name}>
          {session.user.name || session.user.email}
        </span>
      </div>
      <button
        onClick={() => void signOut()}
        className={`btn-secondary ${styles.signOut}`}
      >
        Sign out
      </button>
    </div>
  );
}
