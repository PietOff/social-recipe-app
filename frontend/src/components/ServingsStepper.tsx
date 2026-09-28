import React from 'react';
import { useLang } from '../lib/i18n';
import { formatAmount } from '../lib/scale';
import styles from './extras.module.css';

interface Props {
  /** Servings the recipe was written for, or null when the recipe does not say. */
  base: number | null;
  /** Target servings (with a base) or multiplier (without one). */
  value: number;
  onChange: (value: number) => void;
}

/**
 * "− 4 personen +". Without a known base it scales by a multiplier in steps of
 * a half ("Hoeveelheid ×1½"), since there is no number of people to count.
 */
export default function ServingsStepper({ base, value, onChange }: Props) {
  const { t, lang } = useLang();
  const step = base ? 1 : 0.5;
  const min = base ? 1 : 0.5;
  const max = base ? Math.max(base * 10, 20) : 10;
  const original = base ?? 1;
  const shown = formatAmount(value, lang);

  return (
    <div className={styles.stepper} role="group" aria-label={t.servings}>
      <button
        type="button"
        className={styles.stepperButton}
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label={t.fewer}
      >
        −
      </button>
      <span className={styles.stepperValue} aria-live="polite">
        {base ? t.servingsCount(shown) : t.scaleAmount(shown)}
      </span>
      <button
        type="button"
        className={styles.stepperButton}
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label={t.more}
      >
        +
      </button>
      {value !== original && (
        <button type="button" className={styles.linkButton} onClick={() => onChange(original)}>
          {t.resetScale}
        </button>
      )}
    </div>
  );
}
