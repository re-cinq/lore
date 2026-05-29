'use client';

import { useTheme } from '@/lib/theme/ThemeProvider';
import type { ColorSchemePref, ThemeFamily } from '@/lib/theme/types';
import Icon from './Icon';
import type { IconName } from './icon-map';
import styles from './ThemeSwitcher.module.css';

const FAMILIES: { value: ThemeFamily; label: string }[] = [
  { value: 'elegant', label: 'Elegant' },
  { value: 'retro', label: 'Retro' },
];

const SCHEMES: { value: ColorSchemePref; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'auto', label: 'Auto', icon: 'monitor' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { family, scheme, setFamily, setScheme } = useTheme();

  return (
    <div className={`${styles.switcher}${compact ? ` ${styles.compact}` : ''}`}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Theme</legend>
        <div className={styles.segmented}>
          {FAMILIES.map(({ value, label }) => (
            <label
              key={value}
              className={`${styles.option}${family === value ? ` ${styles.selected}` : ''}`}
            >
              <input
                type="radio"
                name="theme-family"
                value={value}
                checked={family === value}
                onChange={() => setFamily(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Appearance</legend>
        <div className={styles.segmented}>
          {SCHEMES.map(({ value, label, icon }) => (
            <label
              key={value}
              className={`${styles.option}${scheme === value ? ` ${styles.selected}` : ''}`}
            >
              <input
                type="radio"
                name="color-scheme"
                value={value}
                checked={scheme === value}
                onChange={() => setScheme(value)}
              />
              <Icon name={icon} size={14} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
