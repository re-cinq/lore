/**
 * Stacked three-colour spec-coverage bar.
 *
 * Segment widths cover ALL statements (`tested + untested + fluff`); the
 * headline percentage is `tested / (tested + untested)` — narrative ("fluff")
 * is excluded from the denominator so a narrative-heavy spec isn't penalised.
 *
 * Each segment carries a non-colour cue (icon + visually-hidden label) for
 * accessibility (AC11). A spec with no statements renders a muted empty bar
 * so the layout stays consistent.
 */
import styles from './CoverageBar.module.css';

export interface CoverageCounts {
  testable: number;
  covered: number;
  untestable: number;
}

export interface CoverageBarProps {
  coverage: CoverageCounts;
  showCaption?: boolean;
  size?: 'sm' | 'md';
}

export default function CoverageBar({ coverage, showCaption = true, size = 'sm' }: CoverageBarProps) {
  const tested = Math.max(0, coverage.covered);
  const untested = Math.max(0, coverage.testable - coverage.covered);
  const fluff = Math.max(0, coverage.untestable);
  const total = tested + untested + fluff;
  const empty = total === 0;

  const pctTested = empty ? 0 : (tested / total) * 100;
  const pctUntested = empty ? 0 : (untested / total) * 100;
  const pctFluff = empty ? 0 : (fluff / total) * 100;

  const denom = tested + untested;
  const headline = denom === 0 ? null : Math.round((tested / denom) * 100);

  return (
    <div className={`${styles.wrap} ${size === 'md' ? styles.md : ''}`}>
      <div
        className={`${styles.bar} ${empty ? styles.empty : ''}`}
        role="img"
        aria-label={
          empty
            ? 'No testable statements'
            : `${tested} tested, ${untested} untested, ${fluff} narrative`
        }
      >
        {!empty && (
          <>
            {pctTested > 0 && (
              <span
                className={styles.tested}
                style={{ width: `${pctTested}%` }}
                title={`${tested} tested`}
              >
                <span className={styles.cue} aria-hidden>✓</span>
                <span className={styles.sr}>tested</span>
              </span>
            )}
            {pctUntested > 0 && (
              <span
                className={styles.untested}
                style={{ width: `${pctUntested}%` }}
                title={`${untested} untested`}
              >
                <span className={styles.cue} aria-hidden>!</span>
                <span className={styles.sr}>untested</span>
              </span>
            )}
            {pctFluff > 0 && (
              <span
                className={styles.fluff}
                style={{ width: `${pctFluff}%` }}
                title={`${fluff} narrative`}
              >
                <span className={styles.cue} aria-hidden>~</span>
                <span className={styles.sr}>narrative</span>
              </span>
            )}
          </>
        )}
      </div>
      {showCaption && (
        <div className={styles.caption}>
          {empty
            ? <span className={styles.muted}>no statements segmented yet</span>
            : (
              <>
                <strong>{headline === null ? '—' : `${headline}%`}</strong> covered
                <span className={styles.dot}> · </span>
                <span className={styles.tag}><span className={styles.dotTested} aria-hidden /> {tested} tested</span>
                <span className={styles.dot}> · </span>
                <span className={styles.tag}><span className={styles.dotUntested} aria-hidden /> {untested} untested</span>
                <span className={styles.dot}> · </span>
                <span className={styles.tag}><span className={styles.dotFluff} aria-hidden /> {fluff} narrative</span>
              </>
            )
          }
        </div>
      )}
    </div>
  );
}
