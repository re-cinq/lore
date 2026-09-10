"use client";

import { useSession, signOut } from "next-auth/react";
import styles from "./UserMenu.module.css";

export default function UserMenu() {
  const { data: session } = useSession();
  const user = session?.user;

  if (!user) {
    return null;
  }

  return (
    <div className={styles.menu}>
      <UserIdentity image={user.image} name={user.name || user.email} />
      <button
        onClick={() => void signOut()}
        className={`btn-secondary ${styles.signOut}`}
      >
        Sign out
      </button>
    </div>
  );
}

interface UserIdentityProps {
  image?: string | null;
  name?: string | null;
}

/** Who is signed in: the avatar when the provider gave one, and whatever name it knows them by. */
function UserIdentity({ image, name }: UserIdentityProps) {
  return (
    <div className={styles.identity}>
      {image && <img src={image} alt="avatar" className={styles.avatar} />}
      <span className={styles.name}>{name}</span>
    </div>
  );
}
