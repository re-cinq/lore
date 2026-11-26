import styles from "./SidebarVersion.module.css";

interface SidebarVersionProps {
  /** The running release tag (`v1.2.3`), or the short SHA of a build that was not released. */
  running: string;
  /** The public repository's releases page. */
  releasesUrl: string;
  /** The newer release, when there is one; the badge only links to its notes. */
  update: { tag: string; url: string } | null;
}

/** The running version with a way to the releases, and a notice when a newer one exists. In the icon rail the text hides and a dot stands for the notice. */
export default function SidebarVersion(props: SidebarVersionProps) {
  const { running, releasesUrl, update } = props;

  return (
    <>
      <div className={`${styles.version} rail-hidden`}>
        <span className={styles.build}>Lore {running}</span>
        <span className={styles.links}>
          <ExternalLink href={releasesUrl}>Releases</ExternalLink>
          {update && (
            <ExternalLink href={update.url} className={styles.badge}>
              Update available: {update.tag}
            </ExternalLink>
          )}
        </span>
      </div>
      {update && <UpdateDot tag={update.tag} />}
    </>
  );
}

interface ExternalLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

function ExternalLink({ href, className, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

function UpdateDot({ tag }: { tag: string }) {
  return (
    <span
      className={styles.dot}
      role="img"
      aria-label={`Update available: ${tag}`}
    />
  );
}
