import React, { useMemo, useState } from 'react';
import { useLang } from '../lib/i18n';
import { aggregate, ShoppingList, toText } from '../lib/shopping';
import { formatAmount } from '../lib/scale';
import pageStyles from '../app/page.module.css';
import styles from './extras.module.css';

interface Props {
  list: ShoppingList;
  onToggle: (itemKey: string) => void;
  onRemoveRecipe: (recipeKey: string) => void;
  onUncheckAll: () => void;
  onClear: () => void;
}

/**
 * The combined shopping list. Items from several recipes are merged and
 * quantities of the same unit added up; ticking an item crosses it off.
 */
export default function ShoppingListView({ list, onToggle, onRemoveRecipe, onUncheckAll, onClear }: Props) {
  const { t, lang } = useLang();
  const [copied, setCopied] = useState(false);
  const items = useMemo(() => aggregate(list, lang), [list, lang]);
  // Unticked first, so what is still to buy stays at the top.
  const ordered = useMemo(
    () => [...items].sort((a, b) => Number(list.checked.includes(a.key)) - Number(list.checked.includes(b.key))),
    [items, list.checked],
  );

  const copy = async () => {
    const text = `${t.shoppingList}\n\n${toText(items, list.checked)}`;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: t.shoppingList, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* share sheet dismissed or clipboard blocked */
    }
  };

  return (
    <div className={pageStyles.recipeCard}>
      <div className={styles.listHeader}>
        <h2>🛒 {t.shoppingList}</h2>
        {items.length > 0 && (
          <div className={styles.actions}>
            <button type="button" className={pageStyles.textButton} onClick={onUncheckAll} disabled={!list.checked.length}>
              {t.uncheckAll}
            </button>
            <button
              type="button"
              className={pageStyles.textButton}
              onClick={() => { if (confirm(t.confirmClearList)) onClear(); }}
            >
              {t.clearList}
            </button>
            <button type="button" className={pageStyles.button} onClick={copy}>
              {copied ? t.listCopied : t.copyList}
            </button>
          </div>
        )}
      </div>

      {list.entries.length === 0 ? (
        <p className={styles.empty}>{t.shoppingEmpty}</p>
      ) : (
        <>
          <p style={{ opacity: 0.6, fontSize: '0.85rem', margin: '0 0 0.5rem' }}>{t.shoppingFrom(list.entries.length)}</p>
          <div className={styles.chips}>
            {list.entries.map(entry => (
              <span key={entry.key} className={styles.chip}>
                {entry.title}{entry.factor !== 1 && ` ×${formatAmount(entry.factor, lang)}`}
                <button
                  type="button"
                  onClick={() => onRemoveRecipe(entry.key)}
                  aria-label={`${t.removeFromList}: ${entry.title}`}
                  title={t.removeFromList}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <ul className={styles.items}>
            {ordered.map(item => {
              const done = list.checked.includes(item.key);
              return (
                <li key={item.key}>
                  <label className={`${styles.item} ${done ? styles.done : ''}`}>
                    <input type="checkbox" checked={done} onChange={() => onToggle(item.key)} />
                    <span className={styles.itemText}>
                      <span className={styles.itemName}>
                        {item.amounts.length > 0 && <b>{item.amounts.join(' + ')}</b>} {item.name}
                      </span>
                      {list.entries.length > 1 && (
                        <span className={styles.itemFrom}>{item.recipes.join(', ')}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
