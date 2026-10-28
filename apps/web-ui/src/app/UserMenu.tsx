import Icon from "@/components/Icon";
import styles from "./UserMenu.module.css";

interface UserMenuProps {
  /** The deployed build (git SHA), what someone reads to tell whether what they see is what was merged. */
  version: string;
  /** The signed-in person, or null when no one is. */
  user: { name: string; image: string | null } | null;
}

/** The sidebar's foot: who is signed in, the build they are looking at, and the way out. The build shows even when no one is signed in. */
export default function UserMenu({ version, user }: UserMenuProps) {
  if (!user) {
    return (
      <div className={`${styles.menu} rail-hidden`}>
        <Identity version={version} />
      </div>
    );
  }
  return (
    <div className={`${styles.menu} rail-hidden`}>
      <Avatar image={user.image} name={user.name} />
      <Identity name={user.name} version={version} />
      <SignOutButton />
    </div>
  );
}

/** The name above the deployed build, in mono. */
function Identity({
  name,
  version,
}: {
  name?: string | null;
  version: string;
}) {
  return (
    <span className={styles.who}>
      {name && <span className={styles.name}>{name}</span>}
      <span className={styles.version} title="Deployed build (git SHA)">
        lore-ui {version}
      </span>
    </span>
  );
}

/** The provider's picture when it gave one, the person's initials otherwise. */
function Avatar({
  image,
  name,
}: {
  image?: string | null;
  name?: string | null;
}) {
  if (image) {
    return <img src={image} alt="avatar" className={styles.avatar} />;
  }

  return (
    <span className={`${styles.avatar} ${styles.initials}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Up to two initials: first and last word of a name, or the first letter of an email's local part. */
export function initials(name?: string | null): string {
  const [local] = (name ?? "").split("@");
  const words = local.split(/[\s._-]+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";

  return (first + last).toUpperCase();
}

function SignOutButton() {
  return (
    <form method="post" action="/auth/signout">
      <button
        type="submit"
        className={styles.signOut}
        aria-label="Sign out"
        title="Sign out"
      >
        <Icon name="signOut" size={16} />
      </button>
    </form>
  );
}
